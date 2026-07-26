import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { AuditAction } from './audit-log.entity';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Roles(Role.ADMIN)
  findAll(
    @Query('action') action?: AuditAction,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({ action, q, limit: limit ? Number(limit) : undefined });
  }
}
