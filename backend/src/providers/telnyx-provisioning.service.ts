import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
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
    private readonly settings: SettingsService,
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
    const outboundProfileId = await this.resolveOutboundVoiceProfileId();
    if (!outboundProfileId) {
      throw new BadRequestException(
        'No outbound voice profile found on the Telnyx account — without one the new line cannot place calls. Create one in the Telnyx portal (Voice → Outbound Voice Profiles) and retry.',
      );
    }
    const connection = await this.getOrCreateConnection(`snappy-${safeName}`, outboundProfileId);
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

  /**
   * Telnyx connection names are account-unique, and removeDirectLine leaves the
   * connection behind on Telnyx — so re-provisioning the same user must reuse
   * it rather than create a duplicate (error 10015). The suffixed retry covers
   * a create/lookup race or a lookup that missed.
   */
  private async getOrCreateConnection(
    name: string,
    outboundProfileId: string,
  ): Promise<{ id: string }> {
    const existing = await this.telnyx.findCredentialConnectionByName(name);
    if (existing) {
      this.logger.log(`Reusing existing Telnyx connection "${name}" (${existing.id})`);
      await this.ensureOutboundProfile(existing.id, outboundProfileId);
      return existing;
    }
    try {
      return await this.telnyx.createCredentialConnection(name, outboundProfileId);
    } catch (err) {
      if (!(err as Error).message?.includes('10015')) throw err;
      return this.telnyx.createCredentialConnection(
        `${name}-${Date.now().toString(36)}`,
        outboundProfileId,
      );
    }
  }

  /**
   * The outbound voice profile for per-user connections: the one set in
   * Settings → Telnyx wins, then the shared connection's (the line that worked
   * before direct lines existed), then the first profile on the account.
   */
  private async resolveOutboundVoiceProfileId(): Promise<string | null> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (cfg.outboundVoiceProfileId) return String(cfg.outboundVoiceProfileId);
    if (cfg.connectionId) {
      try {
        const shared = await this.telnyx.getConnectionOutboundVoiceProfileId(
          String(cfg.connectionId),
        );
        if (shared) return shared;
      } catch {
        // The shared connection may be a different type or gone; fall through.
      }
    }
    return this.telnyx.firstOutboundVoiceProfileId();
  }

  private async ensureOutboundProfile(
    connectionId: string,
    outboundProfileId: string,
  ): Promise<boolean> {
    const current = await this.telnyx.getConnectionOutboundVoiceProfileId(connectionId);
    if (current) return false;
    await this.telnyx.setConnectionOutboundVoiceProfile(connectionId, outboundProfileId);
    return true;
  }

  /**
   * Attach the outbound voice profile to every already-provisioned direct
   * line that is missing one. Connections created before this fix existed
   * came up without a profile, so their outbound calls were all rejected.
   */
  async repairDirectLines(): Promise<{
    checked: number;
    repaired: number;
    failed: string[];
  }> {
    const outboundProfileId = await this.resolveOutboundVoiceProfileId();
    if (!outboundProfileId) {
      throw new BadRequestException(
        'No outbound voice profile found on the Telnyx account. Create one in the Telnyx portal (Voice → Outbound Voice Profiles) and retry.',
      );
    }
    const users = await this.usersRepo.find();
    let checked = 0;
    let repaired = 0;
    const failed: string[] = [];
    for (const user of users) {
      const connectionId = user.providerConfig?.telnyxConnectionId;
      if (!connectionId) continue;
      checked++;
      try {
        if (await this.ensureOutboundProfile(String(connectionId), outboundProfileId)) {
          repaired++;
          this.logger.log(
            `Attached outbound voice profile to ${user.email}'s connection ${connectionId}`,
          );
        }
      } catch (err) {
        failed.push(`${user.email}: ${(err as Error).message}`);
      }
    }
    return { checked, repaired, failed };
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

  /** Every number on the Telnyx account with the recruiter (if any) holding it. */
  async numberOverview(): Promise<
    Array<{ phoneNumber: string; assignedTo: { id: string; name: string; email: string } | null }>
  > {
    const [numbers, users] = await Promise.all([
      this.telnyx.listNumbers(),
      this.usersRepo.find(),
    ]);
    const byNumber = new Map(
      users
        .filter((u) => u.providerConfig?.telnyxNumber)
        .map((u) => [u.providerConfig!.telnyxNumber as string, u]),
    );
    return numbers.map((n) => {
      const owner = byNumber.get(n.phoneNumber);
      return {
        phoneNumber: n.phoneNumber,
        assignedTo: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      };
    });
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
