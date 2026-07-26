import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { ActivityService } from './activity.service';

@ApiTags('Activity')
@ApiBearerAuth()
@Controller('activity')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  @Get()
  @Roles(Role.ADMIN)
  recent(@Query('limit') limit?: string) {
    return this.service.recent(limit ? Number(limit) : 20);
  }
}
