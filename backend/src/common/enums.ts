export enum Role {
  ADMIN = 'admin',
  USER = 'user',
}

export enum CallingProvider {
  TELNYX = 'telnyx',
  GRANDSTREAM = 'grandstream',
  NATIVE_DIALER = 'native_dialer',
}

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
