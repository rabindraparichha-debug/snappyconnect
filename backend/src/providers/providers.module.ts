import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallLog } from '../calls/call-log.entity';
import { CallRequest } from '../calls/call-request.entity';
import { SettingsModule } from '../settings/settings.module';
import { GrandstreamProvider } from './grandstream.provider';
import { NativeDialerProvider } from './native-dialer.provider';
import { ProvidersService } from './providers.service';
import { TelnyxProvider } from './telnyx.provider';

@Module({
  imports: [SettingsModule, TypeOrmModule.forFeature([CallLog, CallRequest])],
  providers: [ProvidersService, TelnyxProvider, GrandstreamProvider, NativeDialerProvider],
  exports: [ProvidersService, TelnyxProvider],
})
export class ProvidersModule {}
