import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallingProvider, CallRequestStatus } from '../common/enums';
import { CallRequest } from '../calls/call-request.entity';
import {
  CallingProviderStrategy,
  InitiateCallInput,
  InitiateCallResult,
} from './provider.interface';

/**
 * Native Mobile Dialer (India). No VoIP: the browser queues a call request,
 * the SnappyConnect mobile app picks it up, opens the phone's native dialer
 * (user's own SIM), and syncs duration/outcome back after the call.
 */
@Injectable()
export class NativeDialerProvider implements CallingProviderStrategy {
  readonly key = CallingProvider.NATIVE_DIALER;

  constructor(
    @InjectRepository(CallRequest)
    private readonly requestsRepo: Repository<CallRequest>,
  ) {}

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    // Cancel any stale pending requests so the mobile app only ever sees the latest.
    await this.requestsRepo.update(
      { userId: input.user.id, status: CallRequestStatus.PENDING },
      { status: CallRequestStatus.CANCELED },
    );

    const request = await this.requestsRepo.save(
      this.requestsRepo.create({
        userId: input.user.id,
        phoneNumber: input.phoneNumber,
        status: CallRequestStatus.PENDING,
        source: input.source,
      }),
    );

    return {
      action: 'queued_to_mobile',
      provider: this.key,
      phoneNumber: input.phoneNumber,
      requestId: request.id,
      message: 'Call request sent to your mobile app — it will open the native dialer.',
    };
  }
}
