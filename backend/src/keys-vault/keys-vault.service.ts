import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Central keys vault client (Snappy Care → Keys & health, product "snappyconnect").
 *
 * SnappyHires keeps its own provider API keys for every product in one
 * encrypted vault on the ATS. This service:
 *   • fetches SnappyConnect's keys on a timer (every refresh_seconds the hub sends,
 *     5 min by default) — GET {KEYS_VAULT_URL}/api/platform-keys/v1/keys with
 *     Bearer KEYS_VAULT_TOKEN — in the order set on the dashboard;
 *   • keeps the last good copy in memory and in a file OUTSIDE the deployed
 *     folders (default /opt/snappyconnect/.keys-vault.enc — deploys rsync only
 *     backend/ and web/), AES-256-GCM encrypted with a key derived from the token;
 *   • reports calls / errors / tokens / cost / the provider's verdict per key
 *     and per task (e.g. assistant_chat) back to the hub once a minute;
 *   • tells the hub which variable names this code asks for (?wants=), so the
 *     dashboard can show what SnappyConnect would use.
 *
 * A vault AI key may carry config.model — the model the super admin chose for
 * that key. Calls made with that key use it (see modelFor); keys without one
 * keep the code's model.
 *
 * Covers third-party PROVIDER keys only: the AI key (with fail-over) and the
 * Telnyx API key (primary only — Telnyx connections and numbers belong to one
 * account). Our own equipment and secrets — Grandstream, Dinstar, Asterisk,
 * SIP passwords, JWT, the settings encryption key — stay where they are.
 *
 * INERT without KEYS_VAULT_TOKEN: every accessor returns nothing and
 * SnappyConnect uses its admin-settings keys exactly as before. Never throws.
 */

export interface VaultKey {
  id: string;
  provider: string;
  label: string;
  secret: string;
  config: Record<string, unknown>;
}

type Snapshot = { fetchedAt: number; refreshSeconds: number; keys: Record<string, VaultKey[]> };
type Tally = { task: string; calls: number; errors: number; cost: number; inTok: number; outTok: number; status?: string; detail?: string };

export type KeyOutcome =
  | { ok: true; model: string; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { ok: false; error: unknown };

/** USD per million tokens for the models SnappyConnect calls (published rates). */
/** Variable names SnappyConnect's code reads from the vault even before it first asks. */
const STATIC_WANTS = ['TELNYX_API_KEY', 'OPENAI_API_KEY'];

/** The hub's task-name rule: lower-case [a-z0-9_.:-], at most 40 characters; '' when unusable. */
export function cleanTask(task: string | undefined): string {
  const t = (task ?? '').trim().toLowerCase();
  return /^[a-z0-9_.:-]{1,40}$/.test(t) ? t : '';
}

const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-6-luna': { in: 0.1, out: 0.5 },
  'gpt-6-sol': { in: 2, out: 10 },
  'gpt-6.1-sol': { in: 2, out: 10 },
  'gpt-6-astra': { in: 10, out: 50 },
  'gpt-5.6-luna': { in: 0.2, out: 1.2 },
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  'gpt-5-mini': { in: 0.25, out: 2 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2, out: 8 },
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
};


/** Classifies a provider error the way the hub does. */
export function verdictOf(error: unknown): 'invalid' | 'no_credits' | 'rate_limited' | 'error' {
  const status = (error as { status?: number; response?: { status?: number } })?.status ?? (error as { response?: { status?: number } })?.response?.status ?? 0;
  const msg = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) return 'invalid';
  if (status === 402 || (status === 429 && /quota|insufficient|billing|credit/i.test(msg))) return 'no_credits';
  if (status === 429) return 'rate_limited';
  return 'error';
}

@Injectable()
export class KeysVaultService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeysVaultService.name);
  private readonly base: string;
  private readonly token: string;
  private snapshot: Snapshot | null = null;
  private readonly cacheFile: string;
  private refreshTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, Tally>();
  private readonly wanted = new Set<string>(STATIC_WANTS);

  constructor(private config: ConfigService) {
    this.base = (this.config.get<string>('KEYS_VAULT_URL') ?? 'https://hire.snappyhires.com').replace(/\/+$/, '');
    this.token = this.config.get<string>('KEYS_VAULT_TOKEN') ?? '';
    this.cacheFile = this.config.get<string>('KEYS_VAULT_CACHE') ?? path.resolve(process.cwd(), '..', '.keys-vault.enc');
  }

  enabled(): boolean {
    return this.token.startsWith('spk_');
  }

  async onModuleInit() {
    if (!this.enabled()) return;
    this.snapshot = this.readCopy();
    await this.fetchNow();
    this.schedule();
    this.flushTimer = setInterval(() => void this.flushUsage(), 60_000);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushUsage();
  }

  private schedule() {
    const seconds = this.snapshot?.refreshSeconds ?? 300;
    this.refreshTimer = setTimeout(async () => {
      await this.fetchNow();
      this.schedule();
    }, seconds * 1000);
    this.refreshTimer.unref?.();
  }

  // ── Encrypted copy on disk ───────────────────────────────────────────────
  private copyKey(): Buffer {
    return createHash('sha256').update(`keys-vault-cache:${this.token}`).digest();
  }

  private writeCopy(s: Snapshot) {
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.copyKey(), iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(s), 'utf8'), cipher.final()]);
      mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      writeFileSync(`${this.cacheFile}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'), { mode: 0o600 });
      renameSync(`${this.cacheFile}.tmp`, this.cacheFile);
    } catch (e) {
      this.logger.warn(`keys vault: could not save the local copy (${e instanceof Error ? e.message : e})`);
    }
  }

  private readCopy(): Snapshot | null {
    try {
      const raw = Buffer.from(readFileSync(this.cacheFile, 'utf8'), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.copyKey(), raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as Snapshot;
    } catch {
      return null; // no file yet, or a different token wrote it
    }
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async fetchNow(): Promise<void> {
    if (!this.enabled()) return;
    try {
      const res = await fetch(`${this.base}/api/platform-keys/v1/keys${this.wantsQuery()}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`vault answered ${res.status}`);
      const body = (await res.json()) as { refresh_seconds?: number; keys?: Record<string, { id: string; provider: string; label: string; secret: string; config: unknown }[]> };
      const keys: Record<string, VaultKey[]> = {};
      for (const [env, list] of Object.entries(body.keys ?? {})) {
        keys[env] = list
          .filter((k) => typeof k.secret === 'string' && k.secret)
          .map((k) => ({ id: k.id, provider: k.provider, label: k.label, secret: k.secret, config: (k.config ?? {}) as Record<string, unknown> }));
      }
      this.snapshot = { fetchedAt: Date.now(), refreshSeconds: Math.max(60, body.refresh_seconds ?? 300), keys };
      this.writeCopy(this.snapshot);
    } catch (e) {
      this.logger.warn(`keys vault: fetch failed, keeping the last copy (${e instanceof Error ? e.message : e})`);
    }
  }

  /** `?wants=A,B` — every name the code has asked for, sorted, at most 100. */
  private wantsQuery(): string {
    const names = [...this.wanted].sort().slice(0, 100);
    return names.length ? `?wants=${names.map(encodeURIComponent).join(',')}` : '';
  }

  /** Records variable names the code reads, so the next fetch tells the hub. */
  want(...envNames: string[]): void {
    for (const n of envNames) if (n && n.trim()) this.wanted.add(n.trim());
  }

  // ── Accessors ─────────────────────────────────────────────────────────────
  /** Vault keys for one variable name, in the dashboard's order. */
  pool(envName: string): VaultKey[] {
    this.want(envName);
    return this.enabled() ? (this.snapshot?.keys[envName] ?? []) : [];
  }

  /** Vault keys first (dashboard order), then Careers' own keys; duplicates removed. */
  keys(envName: string, ...own: (string | null | undefined)[]): string[] {
    const out: string[] = [];
    for (const k of [...this.pool(envName).map((v) => v.secret), ...own]) if (k && !out.includes(k)) out.push(k);
    return out;
  }

  /** The first usable key: the vault's primary, else Careers' own. */
  key(envName: string, ...own: (string | null | undefined)[]): string | undefined {
    return this.keys(envName, ...own)[0];
  }

  /** Every vault key of one provider type (e.g. custom_llm endpoints), in order. */
  byProvider(provider: string): VaultKey[] {
    if (!this.enabled()) return [];
    return Object.values(this.snapshot?.keys ?? {}).flat().filter((k) => k.provider === provider);
  }

  /** The model the super admin set on this vault key (config.model), else the code's. */
  modelFor(secret: string, fallback: string): string {
    for (const list of Object.values(this.snapshot?.keys ?? {})) {
      for (const k of list) {
        if (k.secret !== secret) continue;
        const m = typeof k.config.model === 'string' ? k.config.model.trim() : '';
        return m || fallback;
      }
    }
    return fallback;
  }

  idOf(secret: string): string | null {
    for (const list of Object.values(this.snapshot?.keys ?? {})) for (const k of list) if (k.secret === secret) return k.id;
    return null;
  }

  // ── Usage reporting ───────────────────────────────────────────────────────
  /** Tallies one call with a vault key; `task` names the operation (e.g. assistant_chat). */
  report(secret: string, outcome: KeyOutcome, task?: string): void {
    const id = this.idOf(secret);
    if (!id) return;
    const day = new Date().toISOString().slice(0, 10);
    const name = cleanTask(task);
    const slot = `${id}|${day}|${name}`;
    const t = this.pending.get(slot) ?? { task: name, calls: 0, errors: 0, cost: 0, inTok: 0, outTok: 0 };
    t.calls += 1;
    if (outcome.ok) {
      const p = PRICES[outcome.model];
      const inTok = outcome.inputTokens ?? 0;
      const outTok = outcome.outputTokens ?? 0;
      t.inTok += inTok;
      t.outTok += outTok;
      t.cost += outcome.costUsd ?? (p ? (inTok * p.in + outTok * p.out) / 1_000_000 : 0);
      t.status = 'ok';
      t.detail = undefined;
    } else {
      t.errors += 1;
      const v = verdictOf(outcome.error);
      if (v !== 'error') {
        t.status = v;
        t.detail = (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)).slice(0, 200);
      }
    }
    this.pending.set(slot, t);
  }

  async flushUsage(): Promise<void> {
    if (!this.enabled() || this.pending.size === 0) return;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    const reports = batch.map(([k, t]) => {
      const [key_id, day] = k.split('|');
      return {
        key_id, day, calls: t.calls, errors: t.errors, cost_usd: Number(t.cost.toFixed(6)),
        input_tokens: t.inTok, output_tokens: t.outTok,
        ...(t.task ? { task: t.task } : {}),
        ...(t.status ? { status: t.status, status_detail: t.detail } : {}),
      };
    });
    try {
      const res = await fetch(`${this.base}/api/platform-keys/v1/usage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reports }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`hub answered ${res.status}`);
    } catch (e) {
      for (const [k, t] of batch) {
        const cur = this.pending.get(k);
        this.pending.set(k, cur ? { ...t, calls: cur.calls + t.calls, errors: cur.errors + t.errors, cost: cur.cost + t.cost, inTok: cur.inTok + t.inTok, outTok: cur.outTok + t.outTok } : t);
      }
      this.logger.warn(`keys vault: usage report failed, will retry (${e instanceof Error ? e.message : e})`);
    }
  }

  /**
   * Runs one call with each key in turn until one answers. Rejected, out-of-
   * credit and rate-limited keys give way to the next; any other error (the
   * provider is down, a bad request) is thrown at once.
   */
  async withKeys<T>(keys: string[], call: (key: string) => Promise<T>, usage: (result: T) => { model: string; inputTokens?: number; outputTokens?: number; costUsd?: number }, task?: string): Promise<T> {
    let last: unknown = new Error('No API key configured');
    for (const key of keys) {
      try {
        const result = await call(key);
        this.report(key, { ok: true, ...usage(result) }, task);
        return result;
      } catch (err) {
        this.report(key, { ok: false, error: err }, task);
        last = err;
        if (verdictOf(err) === 'error') throw err;
      }
    }
    throw last;
  }

  /** Test hook. */
  __setSnapshot(s: Snapshot | null) {
    this.snapshot = s;
  }
}
