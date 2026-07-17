import { BadRequestException, Injectable } from '@nestjs/common';
import { CallingProvider } from '../common/enums';
import { GrandstreamProvider } from './grandstream.provider';
import { NativeDialerProvider } from './native-dialer.provider';
import { CallingProviderStrategy } from './provider.interface';
import { TelnyxProvider } from './telnyx.provider';

/**
 * Registry of calling providers. To add a provider: implement
 * CallingProviderStrategy, add it to the module, and register it here.
 */
@Injectable()
export class ProvidersService {
  private readonly strategies: Map<CallingProvider, CallingProviderStrategy>;

  constructor(
    telnyx: TelnyxProvider,
    grandstream: GrandstreamProvider,
    nativeDialer: NativeDialerProvider,
  ) {
    this.strategies = new Map<CallingProvider, CallingProviderStrategy>([
      [telnyx.key, telnyx],
      [grandstream.key, grandstream],
      [nativeDialer.key, nativeDialer],
    ]);
  }

  getStrategy(provider: CallingProvider | null): CallingProviderStrategy {
    if (!provider) {
      throw new BadRequestException(
        'No calling provider assigned to this user. An admin can assign one in User Management.',
      );
    }
    const strategy = this.strategies.get(provider);
    if (!strategy) {
      throw new BadRequestException(`Unsupported calling provider: ${provider}`);
    }
    return strategy;
  }
}
