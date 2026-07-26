import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallLog } from '../calls/call-log.entity';
import { CallDirection, CallingProvider, CallStatus } from '../common/enums';
import { User } from '../users/user.entity';
import { AmiEvent, AsteriskAmiService } from './asterisk-ami.service';

/**
 * Writes finished Asterisk calls into call history automatically, so UAE calls
 * appear in the dashboard even when they were dialed from a desk softphone or
 * were inbound (a candidate returning a call) — i.e. without the mobile app
 * reporting them.
 *
 * Attribution: the recruiter is identified by the SIP account on the channel
 * (`PJSIP/2001-0000001a` → sipUsername `2001`).
 */
@Injectable()
export class AsteriskCdrService implements OnModuleInit {
  private readonly logger = new Logger(AsteriskCdrService.name);

  /** sipUsername → userId, refreshed lazily so new recruiters are picked up. */
  private lineToUser = new Map<string, string>();
  private lineCacheAt = 0;

  constructor(
    @InjectRepository(CallLog) private readonly callLogsRepo: Repository<CallLog>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly ami: AsteriskAmiService,
  ) {}

  onModuleInit(): void {
    this.ami.onEvent((event) => {
      if (event.Event === 'Cdr') {
        this.ingest(event).catch((err) =>
          this.logger.warn(`CDR ingest failed: ${err.message}`),
        );
      }
    });
    // Connect in the background; a missing/disabled AMI must not block boot.
    this.ami
      .ensureConnected()
      .catch((err) => this.logger.warn(`Asterisk AMI unavailable: ${err.message}`));
  }

  private async ingest(event: AmiEvent): Promise<void> {
    const uniqueId = event.UniqueID || event.Uniqueid;
    if (!uniqueId) return;

    // Local channels are internal dialplan plumbing and emit a CDR per leg —
    // real recruiter calls always ride a PJSIP channel, so only log those.
    const channel = event.Channel ?? '';
    if (!channel.startsWith('PJSIP/')) return;

    // The app may already have logged this call; never duplicate.
    const existing = await this.callLogsRepo.findOne({ where: { externalId: uniqueId } });
    if (existing) return;

    const line = this.lineFromChannel(event.Channel) ?? this.lineFromChannel(event.DestinationChannel);
    const userId = line ? await this.resolveUser(line) : null;

    // Inbound = a call that arrived from the UCM trunk to a recruiter line.
    const inbound = /ucmtrunk/i.test(event.Channel ?? '');
    const billsec = Number(event.BillableSeconds ?? event.Billsec ?? 0);
    const start = event.StartTime ? new Date(event.StartTime.replace(' ', 'T') + 'Z') : new Date();
    const end = event.EndTime ? new Date(event.EndTime.replace(' ', 'T') + 'Z') : null;

    await this.callLogsRepo.save(
      this.callLogsRepo.create({
        userId,
        phoneNumber: inbound ? event.Source || 'unknown' : event.Destination || 'unknown',
        provider: CallingProvider.ASTERISK,
        direction: inbound ? CallDirection.INBOUND : CallDirection.OUTBOUND,
        status: this.mapDisposition(event.Disposition, billsec, inbound),
        durationSeconds: billsec,
        startedAt: start,
        endedAt: end,
        externalId: uniqueId,
        metadata: {
          source: 'asterisk_cdr',
          line,
          channel: event.Channel,
          disposition: event.Disposition,
        },
      }),
    );
  }

  /** `PJSIP/2001-0000001a` → `2001` */
  private lineFromChannel(channel?: string): string | null {
    const match = channel?.match(/^PJSIP\/(\d{4})-/);
    return match ? match[1] : null;
  }

  private async resolveUser(line: string): Promise<string | null> {
    if (Date.now() - this.lineCacheAt > 60_000) {
      const users = await this.usersRepo.find();
      this.lineToUser = new Map(
        users
          .filter((u) => u.providerConfig?.sipUsername)
          .map((u) => [String(u.providerConfig.sipUsername), u.id]),
      );
      this.lineCacheAt = Date.now();
    }
    return this.lineToUser.get(line) ?? null;
  }

  private mapDisposition(disposition = '', billsec = 0, inbound = false): CallStatus {
    switch (disposition.toUpperCase()) {
      case 'ANSWERED':
        return billsec > 0 ? CallStatus.COMPLETED : CallStatus.ANSWERED;
      case 'BUSY':
        return CallStatus.BUSY;
      case 'NO ANSWER':
        return inbound ? CallStatus.MISSED : CallStatus.NO_ANSWER;
      case 'FAILED':
      case 'CONGESTION':
        return CallStatus.FAILED;
      default:
        return CallStatus.COMPLETED;
    }
  }
}
