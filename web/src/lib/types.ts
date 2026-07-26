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

export type CallDisposition =
  | 'interview_scheduled'
  | 'not_interested'
  | 'callback_requested'
  | 'left_voicemail'
  | 'wrong_number'
  | 'offer_made'
  | 'hired'
  | 'no_answer_disposition';

export const DISPOSITION_LABELS: Record<CallDisposition, string> = {
  interview_scheduled: 'Interview Scheduled',
  not_interested: 'Not Interested',
  callback_requested: 'Callback Requested',
  left_voicemail: 'Left Voicemail',
  wrong_number: 'Wrong Number',
  offer_made: 'Offer Made',
  hired: 'Hired',
  no_answer_disposition: 'No Answer',
};

export const DISPOSITION_COLORS: Record<CallDisposition, string> = {
  interview_scheduled: 'bg-emerald-100 text-emerald-700',
  not_interested: 'bg-slate-100 text-slate-600',
  callback_requested: 'bg-amber-100 text-amber-700',
  left_voicemail: 'bg-blue-100 text-blue-700',
  wrong_number: 'bg-rose-100 text-rose-700',
  offer_made: 'bg-violet-100 text-violet-700',
  hired: 'bg-emerald-200 text-emerald-800',
  no_answer_disposition: 'bg-orange-100 text-orange-700',
};

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
  contactName: string | null;
  candidateId: string | null;
  jobId: string | null;
  companyId: string | null;
  region: Region | null;
  country: string | null;
  source: string | null;
  ringTimeSeconds: number;
  recordingUrl: string | null;
  notes: string | null;
  followUpDate: string | null;
  aiSummary: string | null;
  transcript: string | null;
  disposition: CallDisposition | null;
  device: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactTimeline {
  phoneNumber: string;
  contactName: string | null;
  totalCalls: number;
  connectedCalls: number;
  totalTalkTime: number;
  lastCallAt: string;
  firstCallAt: string;
}

export interface FollowUp {
  id: string;
  phoneNumber: string;
  contactName: string | null;
  followUpDate: string;
  notes: string | null;
  status: CallStatus;
  user: User | null;
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

export type SmsDirection = 'inbound' | 'outbound';
export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'received';

export interface SmsLog {
  id: string;
  userId: string | null;
  user: User | null;
  phoneNumber: string;
  direction: SmsDirection;
  body: string;
  status: SmsStatus;
  externalId: string | null;
  createdAt: string;
}

export interface SmsThread {
  phoneNumber: string;
  lastMessage: string;
  lastAt: string;
  direction: SmsDirection;
  total: number;
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

// ---------- Analytics ----------

export interface RecruiterStats {
  totalCalls: number;
  connectedCalls: number;
  missedCalls: number;
  busyCalls: number;
  rejectedCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  connectionRate: number;
  averageDurationSeconds: number;
  totalTalkTimeSeconds: number;
  uniqueCandidatesContacted: number;
  repeatCalls: number;
  callsToday: number;
  callsThisWeek: number;
  callsThisMonth: number;
  avgCallsPerHour: number;
  productivityScore: number;
}

export interface TrendPoint {
  period: string;
  total: number;
  connected: number;
  talkTimeSeconds: number;
  missed?: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  totalCalls: number;
  connectedCalls: number;
  talkTimeSeconds: number;
  uniqueContacts: number;
  connectionRate: number;
}

export interface TeamStats {
  totalCalls: number;
  connectedCalls: number;
  connectionRate: number;
  averageDurationSeconds: number;
  totalTalkTimeSeconds: number;
  byRecruiter: { userId: string; totalCalls: number; connectedCalls: number; talkTimeSeconds: number }[];
  byRegion: { value: string; count: number }[];
  byStatus: { value: string; count: number }[];
  byDirection: { value: string; count: number }[];
}
