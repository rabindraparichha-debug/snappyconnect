export enum Role {
  ADMIN = 'admin',
  USER = 'user',
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
