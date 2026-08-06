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
import { randomUUID } from 'crypto';
import {
  CallDirection,
  CallSource,
  CallStatus,
  CallingProvider,
  Region,
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
  private readonly agentUrl: string;
  private readonly agentSecret: string;
  private readonly publicApiUrl: string;

  constructor(
    private readonly dncService: DncService,
    @InjectRepository(CallLog)
    private readonly callLogsRepo: Repository<CallLog>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    config: ConfigService,
  ) {
    this.agentUrl = config.get<string>('VOICE_AGENT_URL', 'http://127.0.0.1:8091');
    this.agentSecret = config.get<string>('VOICE_AGENT_SECRET', '');
    this.publicApiUrl = config.get<string>(
      'PUBLIC_API_URL',
      'https://call.snappyhires.com/api/v1',
    );
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

    const body = {
      taskId,
      phone,
      trunk,
      contactName: dto.contactName,
      companyName: dto.companyName,
      goalPrompt: dto.goalPrompt,
      scriptTemplate: dto.scriptTemplate,
      resultWebhookUrl: `${this.publicApiUrl}/ai-calls/result`,
    };

    let res: Response;
    try {
      res = await fetch(`${this.agentUrl}/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': this.agentSecret,
        },
        body: JSON.stringify(body),
      });
    } catch {
      await this.markFailed(log.id, 'Voice agent unreachable');
      throw new ServiceUnavailableException(
        'The AI voice agent is not reachable. Check that it is running.',
      );
    }
    if (!res.ok) {
      await this.markFailed(log.id, `Voice agent refused (${res.status})`);
      throw new ServiceUnavailableException(
        `The AI voice agent refused the call (${res.status}).`,
      );
    }

    return {
      taskId,
      callLogId: log.id,
      region,
      message: `AI agent is calling ${phone}. The outcome will appear in call history.`,
    };
  }

  /**
   * Callback target for the voice agent: mid-call events ({taskId, event})
   * and the final result land on the same URL.
   */
  async handleAgentCallback(secret: string | undefined, payload: any) {
    if (!this.agentSecret) {
      throw new ServiceUnavailableException('VOICE_AGENT_SECRET is not configured');
    }
    if (secret !== this.agentSecret) {
      throw new UnauthorizedException();
    }
    const taskId: string | undefined = payload?.taskId;
    if (!taskId) throw new BadRequestException('taskId required');

    const log = await this.callLogsRepo
      .createQueryBuilder('log')
      .where(`log.metadata ->> 'taskId' = :taskId`, { taskId })
      .getOne();
    if (!log) {
      this.logger.warn(`Agent callback for unknown task ${taskId}`);
      return { received: true };
    }

    // Mid-call event
    if (payload.event) {
      if (payload.event === 'answered') {
        await this.callLogsRepo.update(log.id, { status: CallStatus.ANSWERED });
      }
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
    log.durationSeconds = Number(payload.durationSec) || 0;
    log.startedAt = payload.startedAt ? new Date(payload.startedAt) : log.startedAt;
    log.endedAt = payload.endedAt ? new Date(payload.endedAt) : null;
    log.metadata = {
      ...(log.metadata ?? {}),
      outcome,
      summary: payload.summary ?? null,
      meetingTime: payload.meetingTime ?? null,
      callbackTime: payload.callbackTime ?? null,
      transcript: parseTranscript(payload.transcript),
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

/** The agent sends the transcript as a JSON string; keep it bounded. */
function parseTranscript(raw: unknown): unknown[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 500) : null;
  } catch {
    return null;
  }
}
