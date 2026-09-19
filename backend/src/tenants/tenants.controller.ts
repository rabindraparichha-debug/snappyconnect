import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, TenantStatus } from '../common/enums';
import { User } from '../users/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsService } from './tenants.service';

class SetTenantStatusDto {
  @IsEnum(TenantStatus)
  status: TenantStatus;
}

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /** Platform operator: provision a new customer. */
  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  findAll() {
    return this.tenantsService.findAll();
  }

  /** Resolve an ATS company id to its calling tenant. */
  @Get('by-external-ref')
  @Roles(Role.SUPER_ADMIN)
  findByExternalRef(@Query('ref') ref: string) {
    return this.tenantsService.findByExternalRef(ref);
  }

  /**
   * The signed-in user's own tenant — what the company settings screen reads.
   * Available to any authenticated user; no id is accepted, so it cannot be
   * pointed at somebody else's account.
   */
  @Get('me')
  async findOwn(@CurrentUser() user: User) {
    const tenant = await this.tenantsService.findById(user.tenantId);
    const seats = await this.tenantsService.seatUsage(user.tenantId);
    return { ...tenant, seats };
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findById(id);
  }

  @Get(':id/seats')
  @Roles(Role.SUPER_ADMIN)
  seats(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.seatUsage(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantStatusDto) {
    return this.tenantsService.setStatus(id, dto.status);
  }
}
