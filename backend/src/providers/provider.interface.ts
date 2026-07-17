import { CallingProvider, CallSource } from '../common/enums';
import { User } from '../users/user.entity';

export interface InitiateCallInput {
  user: User;
  phoneNumber: string;
  source: CallSource;
}

export interface InitiateCallResult {
  /**
   * What should happen next:
   *  - client_dial:      the web client should place the call itself (Telnyx WebRTC)
   *  - pbx_originated:   the PBX is ringing the user's extension, then dials out
   *  - queued_to_mobile: the mobile app will pick up the request and open the native dialer
   */
  action: 'client_dial' | 'pbx_originated' | 'queued_to_mobile';
  provider: CallingProvider;
  phoneNumber: string;
  /** CallLog id when the backend created one (pbx_originated). */
  callLogId?: string;
  /** CallRequest id for queued_to_mobile. */
  requestId?: string;
  /** URL the extension/external app can open to complete the call in the web dialer. */
  dialUrl?: string;
  message: string;
}

/**
 * Strategy interface for calling providers. Add a new provider by
 * implementing this interface and registering it in ProvidersService.
 */
export interface CallingProviderStrategy {
  readonly key: CallingProvider;
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
}
