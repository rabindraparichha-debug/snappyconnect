import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { SendSmsDto } from './dto/send-sms.dto';
import { SmsService } from './sms.service';

class QuerySmsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

@ApiTags('SMS')
@ApiBearerAuth()
@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  send(@CurrentUser() user: User, @Body() dto: SendSmsDto) {
    return this.smsService.send(user, dto);
  }

  /** Your conversations (every one, for admins) — one entry per contact. */
  @Get('threads')
  threads(@CurrentUser() user: User) {
    return this.smsService.threads(user);
  }

  /** Full message history with one contact. */
  @Get('threads/:phoneNumber')
  thread(@CurrentUser() user: User, @Param('phoneNumber') phoneNumber: string) {
    return this.smsService.thread(user, phoneNumber);
  }

  /**
   * Whether other recruiters already contacted this number and whether the
   * candidate replied — metadata only, never message text.
   */
  @Get('contact-status/:phoneNumber')
  contactStatus(@CurrentUser() user: User, @Param('phoneNumber') phoneNumber: string) {
    return this.smsService.contactStatus(user, phoneNumber);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: QuerySmsDto) {
    return this.smsService.findAll(user, query.page, query.limit);
  }
}
