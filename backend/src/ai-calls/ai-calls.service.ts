import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  CallDirection,
  CallSource,
  CallStatus,
  CallingProvider,
  Region,
  Role,
} from '../common/enums';
import { guessRegion } from '../common/region.util';
import { DncService } from '../dnc/dnc.service';
import { CallLog } from '../calls/call-log.entity';
import { User } from '../users/user.entity';
import { DispatchAiCallDto } from './dto/dispatch-ai-call.dto';

/**
 * Voice-agent trunk keys, by region. India has no AI path (native dialer).
 * USA rides the same Telnyx account as human calling; VITEL_USA remains the
 * CRM's trunk and is unused here.
 */
const REGION_TRUNKS: Partial<Record<Region, string>> = {
  [Region.USA]: 'TELNYX_USA',
  [Region.UAE]: 'DINSTAR_UAE',
};

@Injectable()
export class AiCallsService {
  private readonly logger = new Logger(AiCallsService.name);
  private readonly platformUrl: string;
  private readonly platformKey: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly dncService: DncService,
    @InjectRepository(CallLog)
    private readonly callLogsRepo: Repository<CallLog>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    config: ConfigService,
  ) {
    this.platformUrl = config.get<string>(
      'VOICE_PLATFORM_URL',
      'https://voice.snappyhires.com',
    );
    this.platformKey = config.get<string>('VOICE_PLATFORM_KEY', '');
    this.webhookSecret = config.get<string>('VOICE_PLATFORM_WEBHOOK_SECRET', '');
  }

  /** Hand a call to the AI voice agent and log it as an in-flight call. */
  async dispatch(user: User, dto: DispatchAiCallDto) {
    const number = dto.phoneNumber.replace(/[\s\-().]/g, '');
    if (!number) throw new BadRequestException('phoneNumber is required');

    if (this.dncService.isBlocked(number)) {
      throw new ForbiddenException(
        `${number} is on the Do Not Call list and cannot be dialled.`,
      );
    }

    const region = dto.region ?? guessRegion(number) ?? this.soleRegion(user);
    const trunk = region ? REGION_TRUNKS[region] : undefined;
    if (!region || !trunk) {
      throw new BadRequestException(
        'AI calling works for USA and UAE numbers. Use +1… or a UAE format ' +
          '(+971… / 05…), or pass region explicitly.',
      );
    }
    if (!user.regions?.includes(region)) {
      throw new ForbiddenException(`You do not have ${region} calling access.`);
    }

    const phone = region === Region.USA ? toE164Usa(number) : number;
    const taskId = `sc-${randomUUID()}`;

    const log = await this.callLogsRepo.save(
      this.callLogsRepo.create({
        userId: user.id,
        phoneNumber: phone,
        provider:
          region === Region.USA ? CallingProvider.TELNYX : CallingProvider.ASTERISK,
        direction: CallDirection.OUTBOUND,
        status: CallStatus.INITIATED,
        source: CallSource.API,
        contactName: dto.contactName ?? null,
        region,
        metadata: { ai: true, taskId, trunk, goalPrompt: dto.goalPrompt ?? null },
      }),
    );

    if (!this.platformKey) {
      await this.markFailed(log.id, 'Voice platform key not configured');
      throw new ServiceUnavailableException(
        'AI calling is not configured. Ask an admin to set VOICE_PLATFORM_KEY.',
      );
    }

    // The platform picks the trunk from the number's prefix and returns its
    // own call id; `metadata` comes back on every webhook, so it carries the
    // link to our call log rather than us keeping a side table.
    const body = {
      phone,
      contact_name: dto.contactName,
      company_name: dto.companyName,
      goal_prompt: dto.goalPrompt,
      script_template: dto.scriptTemplate,
      metadata: { taskId, callLogId: log.id },
    };

    let res: Response;
    try {
      res = await fetch(`${this.platformUrl}/v1/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.platformKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      await this.markFailed(log.id, 'Voice platform unreachable');
      throw new ServiceUnavailableException(
        'The AI voice platform is not reachable.',
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      await this.markFailed(log.id, `Voice platform refused (${res.status})`);
      throw new ServiceUnavailableException(
        `The AI voice platform refused the call (${res.status}). ${detail.slice(0, 200)}`,
      );
    }

    // Remember the platform's call id — live supervision addresses calls by it.
    try {
      const platformCall = (await res.json()) as { call_id?: string };
      if (platformCall.call_id) {
        log.metadata = { ...(log.metadata ?? {}), platformCallId: platformCall.call_id };
        await this.callLogsRepo.save(log);
      }
    } catch {
      /* dispatch succeeded; supervision just won't know this call */
    }

    return {
      taskId,
      callLogId: log.id,
      region,
      message: `AI agent is calling ${phone}. The outcome will appear in call history.`,
    };
  }

  /**
   * Callback target for the voice platform: `call.answered` mid-call and
   * `call.completed` at the end, both signed with our webhook secret.
   */
  async handleAgentCallback(
    signature: string | undefined,
    timestamp: string | undefined,
    rawBody: Buffer | undefined,
    payload: any,
  ) {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException(
        'VOICE_PLATFORM_WEBHOOK_SECRET is not configured',
      );
    }
    if (!signature || !timestamp || !rawBody) throw new UnauthorizedException();
    // Reject replays outside a 5-minute window before touching the payload.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      throw new UnauthorizedException();
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }

    const taskId: string | undefined = payload?.metadata?.taskId;
    if (!taskId) throw new BadRequestException('metadata.taskId required');

    const log = await this.callLogsRepo
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'taskId' = :taskId`, { taskId })
      .getOne();
    if (!log) {
      this.logger.warn(`Platform callback for unknown task ${taskId}`);
      return { received: true };
    }

    if (payload.event === 'call.answered') {
      await this.callLogsRepo.update(log.id, { status: CallStatus.ANSWERED });
      return { received: true };
    }
    if (payload.event && payload.event !== 'call.completed') {
      return { received: true };
    }

    // Final result
    const outcome: string = payload.outcome ?? 'ERROR';
    const status =
      outcome === 'NO_ANSWER'
        ? CallStatus.NO_ANSWER
        : outcome === 'ERROR'
          ? CallStatus.FAILED
          : CallStatus.COMPLETED;

    log.status = status;
    log.durationSeconds = Number(payload.duration_sec) || 0;
    log.endedAt = new Date();
    log.metadata = {
      ...(log.metadata ?? {}),
      outcome,
      summary: payload.summary ?? null,
      meetingTime: payload.meeting_time ?? null,
      callbackTime: payload.callback_time ?? null,
      // The platform sends the transcript as an array, not a JSON string.
      transcript: Array.isArray(payload.transcript)
        ? payload.transcript.slice(0, 500)
        : null,
    };
    await this.callLogsRepo.save(log);

    // An opt-out told to the AI counts platform-wide, same as one told to a
    // human — enforce it on every future dial attempt.
    if (outcome === 'OPT_OUT' && log.userId) {
      const owner = await this.usersRepo.findOne({ where: { id: log.userId } });
      if (owner) {
        await this.dncService
          .add(owner, log.phoneNumber, 'Requested opt-out during AI call')
          .catch(() => undefined);
      }
    }

    return { received: true };
  }

  /** This user's AI calls in progress (admins see everyone's). */
  async activeCalls(user: User) {
    const res = await this.platformFetch('GET', '/v1/calls/active');
    const live: Array<{ call_id: string; phone: string; seconds: number; taken_over: boolean }> =
      await res.json();
    if (!live.length) return [];

    const logs = await this.callLogsRepo
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'platformCallId' IN (:...ids)`, {
        ids: live.map((c) => c.call_id),
      })
      .getMany();
    const byPlatformId = new Map(
      logs.map((l) => [String(l.metadata?.platformCallId), l] as const),
    );

    return live
      .filter((c) => {
        const log = byPlatformId.get(c.call_id);
        if (!log) return false;
        return user.role === Role.ADMIN || log.userId === user.id;
      })
      .map((c) => ({
        platformCallId: c.call_id,
        phone: c.phone,
        contactName: byPlatformId.get(c.call_id)?.contactName ?? null,
        seconds: c.seconds,
        takenOver: c.taken_over,
      }));
  }

  /** Listen/speak token for one of the user's own live calls. */
  async listenToken(user: User, platformCallId: string, publish: boolean) {
    await this.assertOwnLiveCall(user, platformCallId);
    const form = new URLSearchParams({ publish: publish ? 'true' : 'false' });
    const res = await this.platformFetch(
      'POST',
      `/v1/calls/${platformCallId}/listen-token`,
      form,
    );
    if (!res.ok) {
      throw new ServiceUnavailableException('That call is no longer live.');
    }
    return res.json();
  }

  /** Stop the AI on the user's own live call so they can carry it on. */
  async takeover(user: User, platformCallId: string) {
    await this.assertOwnLiveCall(user, platformCallId);
    const res = await this.platformFetch('POST', `/v1/calls/${platformCallId}/takeover`);
    if (!res.ok) {
      throw new ServiceUnavailableException('That call is no longer live.');
    }
    const log = await this.findByPlatformId(platformCallId);
    if (log) {
      log.metadata = { ...(log.metadata ?? {}), takenOver: true };
      await this.callLogsRepo.save(log);
    }
    return { ok: true };
  }

  private async assertOwnLiveCall(user: User, platformCallId: string): Promise<void> {
    const log = await this.findByPlatformId(platformCallId);
    if (!log || (user.role !== Role.ADMIN && log.userId !== user.id)) {
      throw new ForbiddenException('Not your call.');
    }
  }

  private async findByPlatformId(platformCallId: string): Promise<CallLog | null> {
    return this.callLogsRepo
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'platformCallId' = :id`, { id: platformCallId })
      .getOne();
  }

  private async platformFetch(
    method: string,
    path: string,
    body?: URLSearchParams,
  ): Promise<Response> {
    try {
      return await fetch(`${this.platformUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.platformKey}` },
        body,
      });
    } catch {
      throw new ServiceUnavailableException('The AI voice platform is not reachable.');
    }
  }

  private soleRegion(user: User): Region | null {
    const dialable = (user.regions ?? []).filter(
      (r) => REGION_TRUNKS[r as Region],
    ) as Region[];
    return dialable.length === 1 ? dialable[0] : null;
  }

  private async markFailed(logId: string, reason: string): Promise<void> {
    const log = await this.callLogsRepo.findOne({ where: { id: logId } });
    if (!log) return;
    log.status = CallStatus.FAILED;
    log.metadata = { ...(log.metadata ?? {}), failure: reason };
    await this.callLogsRepo.save(log);
  }
}

function toE164Usa(n: string): string {
  const digits = n.replace(/\D/g, '');
  if (n.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
