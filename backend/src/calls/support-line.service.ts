import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { CallDirection, CallSource, CallStatus, CallingProvider, UserStatus } from '../common/enums';
import { guessRegion } from '../common/region.util';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import { WebhookEvent } from '../webhooks/webhook.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CallLog } from './call-log.entity';
import { AfterAi, SupportConfig, afterAiLeg, isSupportNumber, matchPerson } from './support-line';

/** What the phone system needs to send a caller to the AI operator. */
export interface AiOperatorLeg {
  taskId: string;
  sipUri: string;
  username: string;
  password: string;
}

/**
 * The support line: an AI operator answers first, then a person takes over.
 *
 * The caller's own leg never leaves our carrier. We lend it to the voice
 * platform's AI agent over SIP; when that leg ends, the caller is still ours
 * and we either end the call (the AI said they were done) or ring a person.
 * Each call is one row in the call log, and its progress is published as
 * `support.call.*` webhooks for other apps.
 */
@Injectable()
export class SupportLineService {
  private readonly logger = new Logger(SupportLineService.name);
  private readonly platformUrl: string;
  private readonly platformKey: string;

  constructor(
    private readonly settings: SettingsService,
    private readonly webhooks: WebhooksService,
    @InjectRepository(CallLog)
    private readonly callLogs: Repository<CallLog>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    config: ConfigService,
  ) {
    this.platformUrl = config.get<string>('VOICE_PLATFORM_URL', 'https://voice.snappyhires.com');
    this.platformKey = config.get<string>('VOICE_PLATFORM_KEY', '');
  }

  /** Stored settings, with the board line as the support number by default. */
  async getConfig(): Promise<SupportConfig & { operatorUserId: string | null; aiAvailable: boolean }> {
    const [support, telnyx] = await Promise.all([
      this.settings.getProviderSettings('support'),
      this.settings.getProviderSettings('telnyx'),
    ]);
    const numbers: string[] =
      Array.isArray(support.numbers) && support.numbers.length > 0
        ? support.numbers
        : telnyx.boardLineNumber
          ? [telnyx.boardLineNumber]
          : [];
    return {
      aiEnabled: Boolean(support.aiEnabled),
      numbers,
      companyName: support.companyName || 'SnappyHires',
      greeting: support.greeting || '',
      instructions: support.instructions || '',
      operatorUserId: telnyx.operatorUserId ?? null,
      aiAvailable: Boolean(this.platformKey),
    };
  }

  /**
   * Ask the AI operator to take this call. Returns where to send the caller,
   * or null when the AI should not or cannot take it — the usual menu runs.
   */
  async announce(callerLeg: string, from?: string, to?: string): Promise<AiOperatorLeg | null> {
    const cfg = await this.getConfig();
    if (!cfg.aiEnabled || !cfg.aiAvailable || !isSupportNumber(cfg.numbers, to)) return null;

    const taskId = `sup-${randomUUID()}`;
    const log = await this.callLogs.save(
      this.callLogs.create({
        userId: cfg.operatorUserId,
        phoneNumber: from || 'Unknown',
        provider: CallingProvider.TELNYX,
        direction: CallDirection.INBOUND,
        status: CallStatus.IN_PROGRESS,
        source: CallSource.API,
        startedAt: new Date(),
        region: guessRegion(to ?? ''),
        metadata: { support: true, ai: true, taskId, callerLeg, line: to ?? null },
      }),
    );

    try {
      const people = (await this.team()).map((u) => u.name);
      const res = await fetch(`${this.platformUrl}/v1/inbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.platformKey}`,
        },
        body: JSON.stringify({
          caller: from || 'unknown',
          called: to,
          company_name: cfg.companyName,
          greeting: cfg.greeting || undefined,
          instructions: cfg.instructions || undefined,
          people,
          metadata: { taskId, callLogId: log.id },
        }),
        // The caller is on the line; a slow platform must not hold them.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`voice platform answered ${res.status}`);
      const body = (await res.json()) as {
        call_id: string;
        sip_uri: string;
        sip_username: string;
        sip_password: string;
      };
      log.metadata = { ...(log.metadata ?? {}), platformCallId: body.call_id };
      await this.callLogs.save(log);
      void this.publish(WebhookEvent.SUPPORT_CALL_STARTED, log);
      return {
        taskId,
        sipUri: body.sip_uri,
        username: body.sip_username,
        password: body.sip_password,
      };
    } catch (err) {
      // No AI for this call: drop the placeholder row so the menu path logs
      // the call the way it always has.
      this.logger.warn(`AI operator unavailable, using the menu: ${(err as Error).message}`);
      await this.callLogs.delete(log.id).catch(() => undefined);
      return null;
    }
  }

  /** The caller never reached the AI: forget the call so the menu path logs it. */
  async abandon(taskId: string): Promise<void> {
    const log = await this.byTaskId(taskId);
    if (log) await this.callLogs.delete(log.id).catch(() => undefined);
  }

  /** The caller's own leg ended. */
  async callerHungUp(callerLeg: string): Promise<void> {
    const log = await this.byCallerLeg(callerLeg);
    if (!log) return;
    log.metadata = { ...(log.metadata ?? {}), callerGone: true };
    if (!log.endedAt) log.endedAt = new Date();
    // The whole call, including any time with a person after the AI.
    if (log.startedAt) {
      const total = Math.round((log.endedAt.getTime() - log.startedAt.getTime()) / 1000);
      log.durationSeconds = Math.max(log.durationSeconds ?? 0, total);
    }
    if (log.status === CallStatus.IN_PROGRESS) log.status = CallStatus.COMPLETED;
    await this.callLogs.save(log);
    void this.publish(WebhookEvent.SUPPORT_CALL_COMPLETED, log);
  }

  /** The AI operator's leg ended: decide what happens to the caller. */
  async aiLegEnded(taskId: string, aiAnswered: boolean): Promise<AfterAi & { line?: string }> {
    const log = await this.byTaskId(taskId);
    const next = afterAiLeg(log?.metadata, { aiAnswered });
    if (log && next.action === 'person') {
      log.metadata = {
        ...(log.metadata ?? {}),
        transferred: true,
        ...(aiAnswered ? {} : { aiFailed: 'The AI operator did not answer' }),
      };
      await this.callLogs.save(log);
    }
    return { ...next, line: log?.metadata?.line ?? undefined };
  }

  /** The team member a caller asked for by name, if exactly one matches. */
  async findPerson(spoken?: string): Promise<User | null> {
    return matchPerson(await this.team(), spoken);
  }

  /** A message was left after nobody picked up: attach it to the call. */
  async noteVoicemail(callerLeg: string, recordingUrl: string): Promise<void> {
    const log = await this.byCallerLeg(callerLeg);
    if (!log) return;
    log.metadata = { ...(log.metadata ?? {}), voicemailUrl: recordingUrl };
    await this.callLogs.save(log);
    void this.publish(WebhookEvent.SUPPORT_CALL_COMPLETED, log);
  }

  /** Events from the voice platform for a support call's AI leg. */
  async handlePlatformEvent(log: CallLog, payload: any): Promise<{ received: true }> {
    const metadata = { ...(log.metadata ?? {}) };
    switch (payload?.event) {
      case 'call.answered':
        metadata.aiAnswered = true;
        log.metadata = metadata;
        await this.callLogs.save(log);
        break;

      case 'call.handoff':
        metadata.handoff = {
          action: payload.handoff === 'hangup' ? 'hangup' : 'transfer',
          reason: payload.reason ?? null,
          person: payload.person ?? null,
        };
        if (payload.message) metadata.message = payload.message;
        log.metadata = metadata;
        await this.callLogs.save(log);
        void this.publish(WebhookEvent.SUPPORT_CALL_HANDOFF, log);
        break;

      case 'call.completed':
        metadata.outcome = payload.outcome ?? 'ERROR';
        if (payload.message) metadata.message = payload.message;
        if (payload.reason && !metadata.handoff) {
          metadata.handoff = { action: payload.handoff ?? 'transfer', reason: payload.reason, person: payload.person ?? null };
        }
        metadata.transcript = Array.isArray(payload.transcript)
          ? payload.transcript.slice(0, 500)
          : null;
        log.metadata = metadata;
        log.aiSummary = payload.summary ?? null;
        log.durationSeconds = Math.max(log.durationSeconds ?? 0, Number(payload.duration_sec) || 0);
        // The AI's part is over. A caller handed to a person is still on the
        // line; that call ends when their own leg does.
        if (!metadata.transferred && metadata.handoff?.action !== 'transfer') {
          log.status = payload.outcome === 'ERROR' ? CallStatus.FAILED : CallStatus.COMPLETED;
          if (!log.endedAt) log.endedAt = new Date();
        }
        await this.callLogs.save(log);
        void this.publish(WebhookEvent.SUPPORT_CALL_COMPLETED, log);
        break;

      default:
        break;
    }
    return { received: true };
  }

  /** Everyone a caller can be put through to. */
  private async team(): Promise<User[]> {
    const users = await this.usersRepo.find({ where: { status: UserStatus.ACTIVE } });
    return users.filter((u) => u.name?.trim());
  }

  private byTaskId(taskId: string): Promise<CallLog | null> {
    return this.callLogs
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'taskId' = :taskId`, { taskId })
      .getOne();
  }

  private byCallerLeg(callerLeg: string): Promise<CallLog | null> {
    return this.callLogs
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'support' = 'true'`)
      .andWhere(`log.metadata ->> 'callerLeg' = :callerLeg`, { callerLeg })
      .getOne();
  }

  /** The shape other apps receive. No carrier identifiers. */
  private async publish(event: WebhookEvent, log: CallLog): Promise<void> {
    const m = log.metadata ?? {};
    await this.webhooks.dispatch(event, {
      id: log.id,
      caller: log.phoneNumber,
      line: m.line ?? null,
      region: log.region ?? null,
      startedAt: log.startedAt?.toISOString() ?? log.createdAt?.toISOString() ?? null,
      endedAt: log.endedAt?.toISOString() ?? null,
      durationSeconds: log.durationSeconds ?? 0,
      // ai = the AI operator has the caller; person = handed to a team
      // member; ended = the call is over.
      stage: log.endedAt ? 'ended' : m.transferred || m.handoff?.action === 'transfer' ? 'person' : 'ai',
      outcome: m.outcome ?? null,
      summary: log.aiSummary ?? null,
      reason: m.handoff?.reason ?? null,
      person: m.handoff?.person ?? null,
      message: m.message ?? null,
      transcript: m.transcript ?? null,
      voicemailUrl: m.voicemailUrl ?? null,
      aiFailed: m.aiFailed ?? null,
    });
  }
}
