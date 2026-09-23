import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFile, unlink, writeFile } from 'fs/promises';
import { Role } from '../common/enums';
import { RecordingsService } from '../calls/recordings.service';
import { AiCallsService } from '../ai-calls/ai-calls.service';
import { User } from '../users/user.entity';
import { VoiceRequest } from './voice-request.entity';

@Injectable()
export class VoiceRequestsService {
  private readonly logger = new Logger(VoiceRequestsService.name);

  constructor(
    @InjectRepository(VoiceRequest)
    private readonly repo: Repository<VoiceRequest>,
    private readonly recordings: RecordingsService,
    private readonly aiCalls: AiCallsService,
  ) {}

  /** A recruiter submits a sample of their own voice for approval. */
  async submit(
    user: User,
    name: string,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<VoiceRequest> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A voice sample is required.');
    }
    const pending = await this.repo.count({
      where: { userId: user.id, status: 'pending' },
    });
    if (pending > 0) {
      throw new BadRequestException(
        'You already have a voice sample waiting for approval.',
      );
    }
    const extension = (file.originalname ?? 'sample.m4a').split('.').pop() ?? 'm4a';
    const filename = `voice-sample-${user.id}-${Date.now()}.${extension}`;
    await writeFile(this.recordings.localPath(filename), file.buffer);
    return this.repo.save(
      this.repo.create({
        userId: user.id,
        name: name.trim(),
        sampleFilename: filename,
        status: 'pending',
      }),
    );
  }

  async list(user: User): Promise<VoiceRequest[]> {
    const where = user.role === Role.ADMIN ? {} : { userId: user.id };
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 100 });
  }

  /** Approval is the point at which the clone is actually created. */
  async approve(admin: User, id: string, provider = 'cartesia'): Promise<VoiceRequest> {
    const request = await this.find(id);
    if (request.status === 'approved') return request;
    const buffer = await readFile(this.recordings.localPath(request.sampleFilename));
    const clone = await this.aiCalls.cloneVoice(
      request.name,
      { buffer, originalname: request.sampleFilename, mimetype: 'audio/mpeg' },
      provider,
    );
    request.status = 'approved';
    request.voiceId = clone.voice_id;
    request.provider = clone.provider ?? provider;
    request.reviewedById = admin.id;
    request.note = null;
    return this.repo.save(request);
  }

  async reject(admin: User, id: string, note?: string): Promise<VoiceRequest> {
    const request = await this.find(id);
    request.status = 'rejected';
    request.reviewedById = admin.id;
    request.note = note?.trim() || 'Not approved.';
    return this.repo.save(request);
  }

  /** Removing the row removes the sample too — an unused recording of
   * someone's voice should not linger on disk. */
  async remove(user: User, id: string): Promise<{ deleted: true }> {
    const request = await this.find(id);
    if (user.role !== Role.ADMIN && request.userId !== user.id) {
      throw new ForbiddenException('That request belongs to someone else.');
    }
    await unlink(this.recordings.localPath(request.sampleFilename)).catch((err) =>
      this.logger.warn(`Could not delete voice sample: ${err.message}`),
    );
    await this.repo.remove(request);
    return { deleted: true };
  }

  /// Path to the submitted sample, so an admin can hear it before deciding.
  async samplePath(user: User, id: string): Promise<string> {
    const request = await this.find(id);
    if (user.role !== Role.ADMIN && request.userId !== user.id) {
      throw new ForbiddenException('That request belongs to someone else.');
    }
    return this.recordings.localPath(request.sampleFilename);
  }

  private async find(id: string): Promise<VoiceRequest> {
    const request = await this.repo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('That request no longer exists.');
    return request;
  }
}
