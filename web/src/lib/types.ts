export type Role = 'admin' | 'user';
export type CallingProvider = 'telnyx' | 'grandstream' | 'native_dialer' | 'asterisk';
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
  regions: Region[];
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

export type Region = 'india' | 'usa' | 'uae';

export const REGIONS: Region[] = ['india', 'usa', 'uae'];

export const REGION_LABELS: Record<Region, string> = {
  india: '🇮🇳 India',
  usa: '🇺🇸 USA',
  uae: '🇦🇪 UAE',
};

/** How each region places calls — shown as a hint in the admin UI. */
export const REGION_HINTS: Record<Region, string> = {
  india: 'Native dialer on the user’s own phone',
  usa: 'Telnyx VoIP (browser & app)',
  uae: 'In-app SIP through the office PBX',
};

export const PROVIDER_LABELS: Record<CallingProvider, string> = {
  telnyx: 'Telnyx (USA)',
  grandstream: 'Grandstream PBX (UAE)',
  native_dialer: 'Native Dialer (India)',
  asterisk: 'In-App SIP (UAE)',
};
