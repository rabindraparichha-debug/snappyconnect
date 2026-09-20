export enum Role {
  /** Platform operator. Spans every tenant; the only role that may manage tenants. */
  SUPER_ADMIN = 'super_admin',
  /** Administrator of a single tenant. */
  ADMIN = 'admin',
  USER = 'user',
}

/**
 * Tenant-level administrator or above.
 *
 * Use this rather than comparing against `Role.ADMIN` directly: the platform
 * operator outranks a tenant admin, so an exact match silently demotes them to
 * a plain user and hides records they are entitled to see.
 */
export function isAdminRole(role: Role | string | undefined | null): boolean {
  return role === Role.ADMIN || role === Role.SUPER_ADMIN;
}

export enum TenantStatus {
  ACTIVE = 'active',
  /** Billing lapsed or manually paused: users can sign in but cannot place calls. */
  SUSPENDED = 'suspended',
  /** Retained for history and billing reconciliation; no sign-in. */
  CANCELED = 'canceled',
}

export enum CallingProvider {
  TELNYX = 'telnyx',
  GRANDSTREAM = 'grandstream',
  NATIVE_DIALER = 'native_dialer',
  ASTERISK = 'asterisk',
}

/** Calling regions a user can be granted access to. */
export enum Region {
  INDIA = 'india',
  USA = 'usa',
  UAE = 'uae',
}

/** Which provider serves each region. */
export const REGION_PROVIDER: Record<Region, CallingProvider> = {
  [Region.INDIA]: CallingProvider.NATIVE_DIALER,
  [Region.USA]: CallingProvider.TELNYX,
  [Region.UAE]: CallingProvider.ASTERISK,
};

/** International dial prefixes used to guess a number's region. */
export const REGION_DIAL_CODES: Record<Region, string[]> = {
  [Region.INDIA]: ['+91', '0091', '91'],
  [Region.USA]: ['+1', '001'],
  [Region.UAE]: ['+971', '00971', '971'],
};

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum CallDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum CallStatus {
  INITIATED = 'initiated',
  RINGING = 'ringing',
  IN_PROGRESS = 'in_progress',
  ANSWERED = 'answered',
  COMPLETED = 'completed',
  MISSED = 'missed',
  FAILED = 'failed',
  BUSY = 'busy',
  NO_ANSWER = 'no_answer',
  CANCELED = 'canceled',
}

export enum CallRequestStatus {
  PENDING = 'pending',
  DISPATCHED = 'dispatched',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
  EXPIRED = 'expired',
}

export enum CallSource {
  WEB = 'web',
  MOBILE = 'mobile',
  EXTENSION = 'extension',
  API = 'api',
}

export enum CallDisposition {
  INTERVIEW_SCHEDULED = 'interview_scheduled',
  NOT_INTERESTED = 'not_interested',
  CALLBACK_REQUESTED = 'callback_requested',
  LEFT_VOICEMAIL = 'left_voicemail',
  WRONG_NUMBER = 'wrong_number',
  OFFER_MADE = 'offer_made',
  HIRED = 'hired',
  NO_ANSWER = 'no_answer_disposition',
}

export enum SmsDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum SmsStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RECEIVED = 'received',
}
