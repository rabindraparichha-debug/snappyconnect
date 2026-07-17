export type Role = 'admin' | 'user';
export type CallingProvider = 'telnyx' | 'grandstream' | 'native_dialer';
export type UserStatus = 'active' | 'inactive';
export type CallDirection = 'inbound' | 'outbound';
export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'in_progress'
  | 'answered'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'busy'
  | 'no_answer'
  | 'canceled';

export interface User {
  id: string;
  name: string;
  email: string;
  mobileNumber: string | null;
  country: string | null;
  role: Role;
  provider: CallingProvider | null;
  providerConfig: Record<string, any>;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CallLog {
  id: string;
  userId: string | null;
  user: User | null;
  phoneNumber: string;
  provider: CallingProvider;
  direction: CallDirection;
  status: CallStatus;
  durationSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  externalId: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  todaysCalls: number;
  answeredCalls: number;
  missedCalls: number;
  totalCallDurationSeconds: number;
}

export interface InitiateCallResult {
  action: 'client_dial' | 'pbx_originated' | 'queued_to_mobile';
  provider: CallingProvider;
  phoneNumber: string;
  callLogId?: string;
  requestId?: string;
  dialUrl?: string;
  message: string;
}

export const PROVIDER_LABELS: Record<CallingProvider, string> = {
  telnyx: 'Telnyx (USA)',
  grandstream: 'Grandstream PBX (UAE)',
  native_dialer: 'Native Dialer (India)',
};
