import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { unlink } from 'fs/promises';
import { Role } from '../common/enums';
import { RecordingsService } from '../calls/recordings.service';
import { User } from '../users/user.entity';
import { Voicemail } from './voicemail.entity';

@Injectable()
export class VoicemailsService {
  private readonly logger = new Logger(VoicemailsService.name);

  constructor(
    @InjectRepository(Voicemail)
    private readonly repo: Repository<Voicemail>,
    private readonly recordings: RecordingsService,
  ) {}

  /**
   * Store a message Telnyx has finished recording.
   *
   * The provider URL is downloaded rather than linked: Telnyx expires its
   * recordings, and a voicemail that disappears is worse than none.
   */
  async record(params: {
    userId: string;
    fromNumber: string;
    sourceUrl: string;
    durationSeconds: number;
    externalId: string;
  }): Promise<Voicemail | null> {
    const filename = `vm-${params.externalId}.mp3`;
    const stored = await this.recordings.downloadTo(filename, params.sourceUrl);
    if (!stored) {
      this.logger.warn(`Voicemail audio could not be fetched for ${params.externalId}`);
    }
    const voicemail = this.repo.create({
      userId: params.userId,
      fromNumber: params.fromNumber,
      // Fall back to the provider copy so the message is never lost outright.
      recordingUrl: stored ? this.recordings.urlFor(filename) : params.sourceUrl,
      durationSeconds: params.durationSeconds,
      read: false,
    });
    return this.repo.save(voicemail);
  }

  /** A recruiter sees only their own messages; admins see everyone's. */
  async list(user: User): Promise<Voicemail[]> {
    const where = user.role === Role.ADMIN ? {} : { userId: user.id };
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async unreadCount(user: User): Promise<number> {
    const where = user.role === Role.ADMIN ? { read: false } : { userId: user.id, read: false };
    return this.repo.count({ where });
  }

  async setRead(user: User, id: string, read: boolean): Promise<Voicemail> {
    const voicemail = await this.own(user, id);
    voicemail.read = read;
    return this.repo.save(voicemail);
  }

  /** Deleting removes the audio too — a "deleted" message that is still on
   * disk is a privacy problem, not a feature. */
  async remove(user: User, id: string): Promise<{ deleted: true }> {
    const voicemail = await this.own(user, id);
    const filename = RecordingsService.filenameFromUrl(voicemail.recordingUrl);
    if (filename && this.recordings.existsLocally(filename)) {
      await unlink(this.recordings.localPath(filename)).catch((err) =>
        this.logger.warn(`Could not delete voicemail audio ${filename}: ${err.message}`),
      );
    }
    await this.repo.remove(voicemail);
    return { deleted: true };
  }

  private async own(user: User, id: string): Promise<Voicemail> {
    const voicemail = await this.repo.findOne({ where: { id } });
    if (!voicemail) throw new NotFoundException('That voicemail no longer exists.');
    if (user.role !== Role.ADMIN && voicemail.userId !== user.id) {
      throw new ForbiddenException('That voicemail belongs to another recruiter.');
    }
    return voicemail;
  }
}
