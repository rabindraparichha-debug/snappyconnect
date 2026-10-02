import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { CallLog } from '../calls/call-log.entity';
import { Role, UserStatus } from '../common/enums';
import { DncService } from '../dnc/dnc.service';
import { User } from '../users/user.entity';
import { Voicemail } from '../voicemails/voicemail.entity';

/**
 * The "customer 360" card Snappy Care (the SnappyHires support desk) shows
 * for SnappyConnect. Read-only, and deliberately thin: call facts only.
 *
 * Never leaves here: recordings or their URLs, transcripts, AI summaries,
 * call notes, contact names, e-mail addresses of agents, or anybody else's
 * phone number in full. The response is built field by field from scratch —
 * no entity is ever spread into it — so a new CallLog column cannot leak.
 */
export interface CarePeopleCard {
  found: boolean;
  product: 'snappyconnect';
  roles: string[];
  summary: string;
  last_activity_at: string | null;
  flags: Record<string, boolean>;
  facts: { label: string; value: string }[];
  links: { label: string; url: string }[];
}

export interface CarePeopleQuery {
  universeId?: string;
  email?: string;
  phone?: string;
}

const MAX_STRING = 200;
const MAX_FACTS = 12;
const RECENT_CALLS = 5;
const WINDOW_DAYS = 90;

export function cap(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** "+•••••1234" — enough for an agent to say "the number ending 1234". */
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '+•••••';
  return `+•••••${digits.slice(-4)}`;
}

/** Digits only, 7–15 of them, or '' when this is not a phone number. */
export function phoneDigits(raw: string | null | undefined): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

/**
 * call_logs.phoneNumber is stored as it was typed or as the provider sent it
 * ("+16305551234", "16305551234", "6305551234", "0016305551234"), so one
 * person can sit under several spellings. These are matched with IN (…) so
 * the existing index is used; numbers stored with spaces or dashes inside
 * are not matched.
 */
export function phoneVariants(raw: string): string[] {
  const digits = phoneDigits(raw);
  if (!digits) return [];
  const out = new Set<string>();
  const add = (d: string) => {
    out.add(d);
    out.add(`+${d}`);
    out.add(`00${d}`);
  };
  add(digits);
  if (digits.length === 10) {
    add(`1${digits}`); // bare US/Canada number
  } else if (digits.length === 11 && digits.startsWith('1')) {
    out.add(digits.slice(1));
  }
  return [...out];
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function when(call: CallLog): Date {
  return new Date(call.startedAt ?? call.createdAt);
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function outcome(call: CallLog): string {
  const raw = String(call.disposition || call.status || 'unknown');
  return raw.replace(/_disposition$/, '').replace(/_/g, ' ');
}

function callFact(call: CallLog, tail: string): { label: string; value: string } {
  return {
    label: 'Call',
    value: cap(
      `${day(when(call))} ${call.direction} · ${formatDuration(call.durationSeconds)} · ${outcome(call)} · ${tail}`,
    ),
  };
}

const EMPTY: CarePeopleCard = {
  found: false,
  product: 'snappyconnect',
  roles: [],
  summary: '',
  last_activity_at: null,
  flags: {},
  facts: [],
  links: [],
};

@Injectable()
export class CarePeopleService {
  constructor(
    @InjectRepository(CallLog) private readonly calls: Repository<CallLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Voicemail) private readonly voicemails: Repository<Voicemail>,
    private readonly dnc: DncService,
    private readonly config: ConfigService,
  ) {}

  async lookup(query: CarePeopleQuery, now: Date = new Date()): Promise<CarePeopleCard> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const email = (query.email ?? '').trim().toLowerCase();
    const variants = query.phone ? phoneVariants(query.phone) : [];

    const roles: string[] = [];
    const flags: Record<string, boolean> = {};
    const accountFacts: CarePeopleCard['facts'] = [];
    const callFacts: CarePeopleCard['facts'] = [];
    const summary: string[] = [];
    const links: CarePeopleCard['links'] = [];
    let last: Date | null = null;
    const seen = (d: Date | null) => {
      if (d && (!last || d > last)) last = d;
    };
    const webUrl = this.config.get<string>('WEB_APP_URL', '').replace(/\/$/, '');

    // (b) A SnappyConnect account. Users carry no SnappyHires universe id
    // (sign-in matches on the verified e-mail), so universe_id alone finds
    // nobody; the e-mail is the key, with the agent's own mobile as a fallback.
    let user: User | null = null;
    if (email) user = await this.users.findOne({ where: { email } });
    if (!user && variants.length) {
      user = await this.users.findOne({ where: { mobileNumber: In(variants) } });
    }
    if (user) {
      const role = user.role === Role.ADMIN ? 'admin' : 'agent';
      roles.push(role);
      flags.account_active = user.status === UserStatus.ACTIVE;
      flags.calling_enabled = Boolean(user.provider) || (user.regions ?? []).length > 0;

      const [handled, handled90] = await Promise.all([
        this.calls.find({
          where: { userId: user.id },
          order: { createdAt: 'DESC' },
          take: RECENT_CALLS,
        }),
        this.calls.count({ where: { userId: user.id, createdAt: MoreThanOrEqual(since) } }),
      ]);

      accountFacts.push({ label: 'Account', value: cap(`${role} · ${user.status}`) });
      const regions = (user.regions ?? []).filter(Boolean);
      if (regions.length) {
        accountFacts.push({ label: 'Calling regions', value: cap(regions.join(', ')) });
      } else if (user.provider) {
        accountFacts.push({ label: 'Calling line', value: cap(String(user.provider)) });
      }
      if (user.createdAt) {
        accountFacts.push({ label: 'Member since', value: day(new Date(user.createdAt)) });
      }
      accountFacts.push({ label: 'Calls handled (90 days)', value: String(handled90) });
      // The agent's own calls: the other party is somebody else, so masked.
      for (const call of handled) {
        callFacts.push(callFact(call, `with ${maskPhone(call.phoneNumber)}`));
      }
      if (handled.length) seen(when(handled[0]));

      summary.push(
        `SnappyConnect ${role} (${user.status}), ${handled90} call${handled90 === 1 ? '' : 's'} handled in the last ${WINDOW_DAYS} days` +
          (handled.length ? `, last on ${day(when(handled[0]))}` : ''),
      );
      if (webUrl) links.push({ label: 'SnappyConnect users', url: `${webUrl}/users` });
    }

    // (a) The number as the outside party of a call.
    if (variants.length) {
      const [recent, count90, voicemailCount] = await Promise.all([
        this.calls.find({
          where: { phoneNumber: In(variants) },
          order: { createdAt: 'DESC' },
          take: RECENT_CALLS,
        }),
        this.calls.count({
          where: { phoneNumber: In(variants), createdAt: MoreThanOrEqual(since) },
        }),
        this.voicemails.count({ where: { fromNumber: In(variants) } }),
      ]);
      const blocked = variants.some((v) => v.startsWith('+') && this.dnc.isBlocked(v));

      if (recent.length || voicemailCount || blocked) {
        roles.push('caller');
        flags.do_not_call = blocked;
        flags.has_voicemail = voicemailCount > 0;
        for (const call of recent) {
          // Display name only — never the agent's e-mail or own number.
          const agent = call.user?.name ? `handled by ${call.user.name}` : 'no agent on record';
          callFacts.push(callFact(call, agent));
        }
        if (recent.length) seen(when(recent[0]));
        summary.push(
          `${count90} call${count90 === 1 ? '' : 's'} in the last ${WINDOW_DAYS} days` +
            (recent.length ? `, last on ${day(when(recent[0]))}` : '') +
            (blocked ? '. On the Do Not Call list' : ''),
        );
        // No number in the URL: it would land in proxy logs and browser history.
        if (webUrl) links.push({ label: 'SnappyConnect call history', url: `${webUrl}/history` });
      }
    }

    if (!roles.length) return { ...EMPTY, flags: {}, roles: [], facts: [], links: [] };

    return {
      found: true,
      product: 'snappyconnect',
      roles,
      summary: cap(summary.join('. ')),
      last_activity_at: last ? (last as Date).toISOString() : null,
      flags,
      facts: [...accountFacts, ...callFacts].slice(0, MAX_FACTS),
      links,
    };
  }
}
