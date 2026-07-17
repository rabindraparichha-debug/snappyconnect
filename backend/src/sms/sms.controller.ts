import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  send(@CurrentUser() user: User, @Body() dto: SendSmsDto) {
    return this.smsService.send(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: QuerySmsDto) {
    return this.smsService.findAll(user, query.page, query.limit);
  }
}
