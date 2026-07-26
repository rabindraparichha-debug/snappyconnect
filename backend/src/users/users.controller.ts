import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, UserStatus } from '../common/enums';
import { User } from './user.entity';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { TelnyxProvisioningService } from '../providers/telnyx-provisioning.service';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

class SetStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

class ProvisionLineDto {
  /** Existing account number to assign; omit to buy a fresh one. */
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @Matches(/^\d{3}$/, { message: 'areaCode must be 3 digits' })
  areaCode?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly provisioning: TelnyxProvisioningService,
    private readonly audit: AuditService,
  ) {}

  /** Numbers on the Telnyx account not yet tied to a recruiter. */
  @Get('telnyx/available-numbers')
  availableNumbers() {
    return this.provisioning.availableNumbers();
  }

  @Post()
  async create(@CurrentUser() actor: User, @Ip() ip: string, @Body() dto: CreateUserDto) {
    const created = await this.usersService.create(dto);
    await this.audit.record(
      actor,
      AuditAction.USER_CREATED,
      `Created ${dto.role ?? 'user'} account for ${created.email}`,
      { targetId: created.id, targetLabel: created.email, ipAddress: ip },
    );
    return created;
  }

  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: User,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const before = await this.usersService.findById(id);
    const updated = await this.usersService.update(id, dto);
    const changes = AuditService.describeChanges(
      before,
      updated,
      ['name', 'email', 'role', 'provider', 'regions', 'status', 'dailyCallTarget', 'weeklyCallTarget'],
    );
    // `password` never reaches describeChanges, so a hash can't leak into the trail.
    const summary = dto.password
      ? `Updated ${before.email} (${changes}); password reset by admin`
      : `Updated ${before.email} (${changes})`;
    await this.audit.record(actor, AuditAction.USER_UPDATED, summary, {
      targetId: id,
      targetLabel: before.email,
      ipAddress: ip,
    });
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: User,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const target = await this.usersService.findById(id);
    await this.usersService.remove(id);
    await this.audit.record(
      actor,
      AuditAction.USER_DELETED,
      `Deleted ${target.role} account ${target.email}`,
      { targetId: id, targetLabel: target.email, ipAddress: ip },
    );
  }

  @Patch(':id/status')
  async setStatus(
    @CurrentUser() actor: User,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
  ) {
    const updated = await this.usersService.setStatus(id, dto.status);
    await this.audit.record(
      actor,
      AuditAction.USER_STATUS_CHANGED,
      `Set ${updated.email} to ${dto.status}`,
      { targetId: id, targetLabel: updated.email, ipAddress: ip },
    );
    return updated;
  }

  @Patch(':id/provider')
  assignProvider(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignProviderDto) {
    return this.usersService.assignProvider(id, dto);
  }

  /** Give this user their own US number + SIP line so inbound calls ring them. */
  @Post(':id/telnyx-line')
  async provisionLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProvisionLineDto) {
    const user = await this.usersService.findById(id);
    return this.provisioning.provisionDirectLine(user, dto.phoneNumber, dto.areaCode);
  }

  @Delete(':id/telnyx-line')
  @HttpCode(204)
  async removeLine(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findById(id);
    await this.provisioning.removeDirectLine(user);
  }
}
