import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { SettingsService } from './settings.service';

@Controller('settings')
@Roles(Role.ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('providers')
  getAll() {
    return this.settingsService.getAllMasked();
  }

  @Put('providers/:key')
  update(@Param('key') key: string, @Body() body: Record<string, any>) {
    return this.settingsService.updateProviderSettings(key, body ?? {});
  }
}
