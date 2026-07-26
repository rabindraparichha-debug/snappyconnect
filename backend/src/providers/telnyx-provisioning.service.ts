import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { TelnyxApiService } from './telnyx-api.service';

export interface DirectLine {
  phoneNumber: string;
  connectionId: string;
  credentialId: string;
}

/**
 * Gives a recruiter their own US line: a dedicated credential connection, a
 * WebRTC credential on it, and a number pinned to that connection so inbound
 * calls ring that recruiter's browser (a number on a shared connection has no
 * way to pick which credential to ring).
 */
@Injectable()
export class TelnyxProvisioningService {
  private readonly logger = new Logger(TelnyxProvisioningService.name);

  constructor(
    private readonly telnyx: TelnyxApiService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * @param phoneNumber existing account number to use; omit to buy a new one.
   * @param areaCode used only when buying (defaults to the NYC 332 range).
   */
  async provisionDirectLine(
    user: User,
    phoneNumber?: string,
    areaCode = '332',
  ): Promise<DirectLine> {
    const existing = user.providerConfig ?? {};
    if (existing.telnyxNumber && existing.telnyxConnectionId) {
      throw new BadRequestException(
        `${user.email} already has direct line ${existing.telnyxNumber}. Remove it first to re-provision.`,
      );
    }

    const number = phoneNumber ?? (await this.telnyx.purchaseNumber(areaCode));
    const safeName = user.email.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
    const connection = await this.telnyx.createCredentialConnection(`snappy-${safeName}`);
    const credential = await this.telnyx.createTelephonyCredential(
      connection.id,
      `snappy-${safeName}`,
    );
    await this.telnyx.assignNumberToConnection(number, connection.id);

    user.providerConfig = {
      ...existing,
      telnyxNumber: number,
      telnyxConnectionId: connection.id,
      telnyxCredentialId: credential.id,
    };
    await this.usersRepo.save(user);
    this.logger.log(`Provisioned ${number} for ${user.email}`);

    return { phoneNumber: number, connectionId: connection.id, credentialId: credential.id };
  }

  /** Frees the number from the user (the number itself stays on the account). */
  async removeDirectLine(user: User): Promise<void> {
    const cfg = { ...(user.providerConfig ?? {}) };
    delete cfg.telnyxNumber;
    delete cfg.telnyxConnectionId;
    delete cfg.telnyxCredentialId;
    user.providerConfig = cfg;
    await this.usersRepo.save(user);
  }

  /** Numbers on the account that are not yet assigned to any recruiter. */
  async availableNumbers(): Promise<string[]> {
    const [numbers, users] = await Promise.all([
      this.telnyx.listNumbers(),
      this.usersRepo.find(),
    ]);
    const taken = new Set(
      users.map((u) => u.providerConfig?.telnyxNumber).filter(Boolean) as string[],
    );
    return numbers.map((n) => n.phoneNumber).filter((n) => !taken.has(n));
  }
}
