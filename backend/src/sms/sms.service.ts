import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallingProvider, Role, SmsDirection, SmsStatus } from '../common/enums';
import { TelnyxProvider } from '../providers/telnyx.provider';
import { User } from '../users/user.entity';
import { SendSmsDto } from './dto/send-sms.dto';
import { SmsLog } from './sms-log.entity';

@Injectable()
export class SmsService {
  constructor(
    @InjectRepository(SmsLog)
    private readonly smsRepo: Repository<SmsLog>,
    private readonly telnyxProvider: TelnyxProvider,
  ) {}

  async send(user: User, dto: SendSmsDto): Promise<SmsLog> {
    // SMS is a Telnyx feature; only Telnyx-assigned users (or admins) can send.
    if (user.role !== Role.ADMIN && user.provider !== CallingProvider.TELNYX) {
      throw new BadRequestException('SMS is only available for users on the Telnyx provider.');
    }

    const log = this.smsRepo.create({
      userId: user.id,
      phoneNumber: dto.to,
      direction: SmsDirection.OUTBOUND,
      body: dto.body,
      status: SmsStatus.QUEUED,
    });

    try {
      const { externalId } = await this.telnyxProvider.sendSms(dto.to, dto.body);
      log.externalId = externalId;
      log.status = SmsStatus.SENT;
    } catch (err) {
      log.status = SmsStatus.FAILED;
      await this.smsRepo.save(log);
      throw err;
    }
    return this.smsRepo.save(log);
  }

  /**
   * Telnyx message webhook: store inbound SMS and reconcile outbound delivery
   * status. Non-message events are ignored (call events are handled elsewhere).
   */
  async handleTelnyxWebhook(event: any): Promise<void> {
    const eventType: string | undefined = event?.data?.event_type;
    const payload = event?.data?.payload;
    if (!eventType?.startsWith('message.') || !payload) return;

    if (eventType === 'message.received') {
      await this.smsRepo.save(
        this.smsRepo.create({
          userId: null,
          phoneNumber: payload.from?.phone_number ?? 'unknown',
          direction: SmsDirection.INBOUND,
          body: payload.text ?? '',
          status: SmsStatus.RECEIVED,
          externalId: payload.id ?? null,
        }),
      );
      return;
    }

    // Outbound lifecycle (message.sent / message.finalized): update by provider id.
    if (!payload.id) return;
    const log = await this.smsRepo.findOne({ where: { externalId: payload.id } });
    if (!log || log.direction !== SmsDirection.OUTBOUND) return;
    const to = Array.isArray(payload.to) ? payload.to[0] : payload.to;
    const status: string | undefined = to?.status ?? payload.status;
    if (status === 'delivered') log.status = SmsStatus.DELIVERED;
    else if (['sending_failed', 'delivery_failed', 'failed'].includes(status ?? '')) {
      log.status = SmsStatus.FAILED;
    }
    await this.smsRepo.save(log);
  }

  async findAll(user: User, page = 1, limit = 20) {
    const qb = this.smsRepo
      .createQueryBuilder('sms')
      .leftJoinAndSelect('sms.user', 'user')
      .orderBy('sms.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (user.role !== Role.ADMIN) {
      qb.andWhere('sms.userId = :id', { id: user.id });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
