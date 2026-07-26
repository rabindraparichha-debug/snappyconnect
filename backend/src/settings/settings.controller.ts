import { Body, Controller, Get, Ip, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
@Roles(Role.ADMIN)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('providers')
  getAll() {
    return this.settingsService.getAllMasked();
  }

  @Put('providers/:key')
  async update(
    @CurrentUser() actor: User,
    @Ip() ip: string,
    @Param('key') key: string,
    @Body() body: Record<string, any>,
  ) {
    const result = await this.settingsService.updateProviderSettings(key, body ?? {});
    // Only the field names are recorded — these payloads carry API keys.
    const fields = Object.keys(body ?? {});
    await this.audit.record(
      actor,
      AuditAction.SETTINGS_UPDATED,
      `Updated ${key} settings (${fields.length ? fields.join(', ') : 'no fields'})`,
      { targetLabel: key, ipAddress: ip },
    );
    return result;
  }
}
