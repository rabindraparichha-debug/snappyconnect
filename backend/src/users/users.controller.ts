import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, UserStatus } from '../common/enums';
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
  ) {}

  /** Numbers on the Telnyx account not yet tied to a recruiter. */
  @Get('telnyx/available-numbers')
  availableNumbers() {
    return this.provisioning.availableNumbers();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
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
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.remove(id);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) {
    return this.usersService.setStatus(id, dto.status);
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
