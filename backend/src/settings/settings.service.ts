import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptString, encryptString } from '../common/crypto.util';
import { Setting } from './setting.entity';
import { KeysVaultService } from '../keys-vault/keys-vault.service';

export const PROVIDER_SETTING_KEYS = ['telnyx', 'grandstream', 'dinstar', 'asterisk', 'ai', 'limits', 'support'] as const;
export type ProviderSettingKey = (typeof PROVIDER_SETTING_KEYS)[number];

/** Fields that are masked when settings are read back through the API. */
const SECRET_FIELDS = ['apiKey', 'password', 'sipPassword', 'token', 'apiSecret'];

const MASK = '••••';

@Injectable()
export class SettingsService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepo: Repository<Setting>,
    config: ConfigService,
    @Optional() private readonly vault?: KeysVaultService,
  ) {
    this.encryptionKey = config.get<string>('SETTINGS_ENCRYPTION_KEY', 'dev-settings-key');
  }

  /**
   * Decrypted settings object for internal (provider) use, with the central
   * keys vault (Snappy Care → Keys & health) laid over it: the vault's primary
   * TELNYX_API_KEY replaces telnyx.apiKey. The AI key is handled by AiService,
   * which tries every key in order. Nothing from the vault is ever saved.
   */
  async getProviderSettings(key: ProviderSettingKey): Promise<Record<string, any>> {
    const stored = await this.readStored(key);
    if (key === 'telnyx' && this.vault) {
      const primary = this.vault.pool('TELNYX_API_KEY')[0];
      if (primary) return { ...stored, apiKey: primary.secret };
    }
    return stored;
  }

  /** What is saved in the database for a namespace — never the vault's keys. */
  private async readStored(key: ProviderSettingKey): Promise<Record<string, any>> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    if (!row) return {};
    try {
      return JSON.parse(decryptString(row.value, this.encryptionKey));
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
    // Merge into what is STORED, so a vault key shown in the admin UI is never
    // written into the database when an admin saves other fields.
    const current = await this.readStored(key as ProviderSettingKey);
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
