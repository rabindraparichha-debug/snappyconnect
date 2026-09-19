import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptString, encryptString } from '../common/crypto.util';
import { TenantContext } from '../common/tenant-context';
import { InjectTenantRepository } from '../common/tenant-orm.module';
import { Tenant } from '../tenants/tenant.entity';
import { Setting } from './setting.entity';

export const PROVIDER_SETTING_KEYS = ['telnyx', 'grandstream', 'dinstar', 'asterisk', 'ai'] as const;
export type ProviderSettingKey = (typeof PROVIDER_SETTING_KEYS)[number];

/** Fields that are masked when settings are read back through the API. */
const SECRET_FIELDS = ['apiKey', 'password', 'sipPassword', 'token', 'apiSecret'];

const MASK = '••••';

@Injectable()
export class SettingsService {
  private readonly encryptionKey: string;

  constructor(
    @InjectTenantRepository(Setting)
    private readonly settingsRepo: Repository<Setting>,
    @InjectRepository(Tenant)
    private readonly tenantsRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
    config: ConfigService,
  ) {
    this.encryptionKey = config.get<string>('SETTINGS_ENCRYPTION_KEY', 'dev-settings-key');
  }

  /**
   * Decrypted settings object for internal (provider) use.
   *
   * Requires a tenant in scope. Provider settings hold API keys and the numbers
   * calls are billed against, so resolving them without a tenant would pick an
   * arbitrary customer's credentials — background and webhook callers must
   * name the tenant via `getProviderSettingsForTenant`.
   */
  async getProviderSettings(key: ProviderSettingKey): Promise<Record<string, any>> {
    this.tenantContext.requireTenantId();
    const row = await this.settingsRepo.findOne({ where: { key } });
    return this.decode(row?.value);
  }

  /**
   * Settings for infrastructure shared by every tenant — the UAE Asterisk box
   * and its AMI credentials — which are held against the platform's own
   * ("default") tenant. Used by background services that run at boot, outside
   * any request, and so have no tenant to inherit.
   */
  async getPlatformProviderSettings(key: ProviderSettingKey): Promise<Record<string, any>> {
    return this.tenantContext.runUnscoped(async () => {
      const platform = await this.tenantsRepo.findOne({ where: { slug: 'default' } });
      if (!platform) return {};
      const row = await this.settingsRepo.findOne({ where: { tenantId: platform.id, key } });
      return this.decode(row?.value);
    });
  }

  /**
   * Provider settings for an explicitly named tenant. For callers that resolve
   * their own tenant — provider webhooks, scheduled sends — rather than
   * inheriting one from a signed-in user.
   */
  async getProviderSettingsForTenant(
    tenantId: string,
    key: ProviderSettingKey,
  ): Promise<Record<string, any>> {
    const row = await this.tenantContext.runUnscoped(() =>
      this.settingsRepo.findOne({ where: { tenantId, key } }),
    );
    return this.decode(row?.value);
  }

  private decode(value?: string): Record<string, any> {
    if (!value) return {};
    try {
      return JSON.parse(decryptString(value, this.encryptionKey));
    } catch {
      return {};
    }
  }

  /** Settings with secret fields masked, for the admin UI. */
  async getMaskedProviderSettings(key: ProviderSettingKey): Promise<Record<string, any>> {
    const settings = await this.getProviderSettings(key);
    const masked: Record<string, any> = {};
    for (const [field, value] of Object.entries(settings)) {
      if (SECRET_FIELDS.includes(field) && typeof value === 'string' && value.length > 0) {
        masked[field] = MASK + value.slice(-4);
      } else {
        masked[field] = value;
      }
    }
    return masked;
  }

  async getAllMasked(): Promise<Record<string, Record<string, any>>> {
    const result: Record<string, Record<string, any>> = {};
    for (const key of PROVIDER_SETTING_KEYS) {
      result[key] = await this.getMaskedProviderSettings(key);
    }
    return result;
  }

  /**
   * Merge-update a settings namespace. Masked values coming back from the UI
   * (or empty strings for secret fields) keep the previously stored secret.
   */
  async updateProviderSettings(
    key: string,
    incoming: Record<string, any>,
  ): Promise<Record<string, any>> {
    if (!PROVIDER_SETTING_KEYS.includes(key as ProviderSettingKey)) {
      throw new BadRequestException(
        `Unknown settings key "${key}". Valid keys: ${PROVIDER_SETTING_KEYS.join(', ')}`,
      );
    }
    const current = await this.getProviderSettings(key as ProviderSettingKey);
    const next: Record<string, any> = { ...current };

    for (const [field, value] of Object.entries(incoming)) {
      const isSecret = SECRET_FIELDS.includes(field);
      if (isSecret && typeof value === 'string' && (value.startsWith(MASK) || value === '')) {
        continue; // keep the stored secret
      }
      next[field] = value;
    }

    const encrypted = encryptString(JSON.stringify(next), this.encryptionKey);
    const row = await this.settingsRepo.findOne({ where: { key } });
    if (row) {
      row.value = encrypted;
      await this.settingsRepo.save(row);
    } else {
      await this.settingsRepo.save(this.settingsRepo.create({ key, value: encrypted }));
    }
    return this.getMaskedProviderSettings(key as ProviderSettingKey);
  }
}
