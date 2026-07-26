import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { DncService } from './dnc.service';

class AddDncDto {
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('Do Not Call')
@ApiBearerAuth()
@Controller('dnc')
export class DncController {
  constructor(private readonly service: DncService) {}

  @Get()
  findAll(@Query('q') q?: string) {
    return this.service.findAll(q);
  }

  /**
   * Pre-dial check for the browser dialer, which places Telnyx calls over
   * WebRTC and so never reaches the server-side guard in `initiate`.
   */
  @Get('check')
  check(@Query('phoneNumber') phoneNumber: string) {
    return { blocked: this.service.isBlocked(phoneNumber ?? '') };
  }

  /** Any recruiter can suppress a number they were asked to stop calling. */
  @Post()
  add(@CurrentUser() user: User, @Body() dto: AddDncDto) {
    return this.service.add(user, dto.phoneNumber, dto.reason);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
