import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import {
  CreateScheduledCallDto,
  UpdateScheduledCallDto,
} from './dto/scheduled-call.dto';
import { ScheduledCallsService } from './scheduled-calls.service';

@ApiTags('Scheduled Calls')
@ApiBearerAuth()
@Controller('scheduled-calls')
export class ScheduledCallsController {
  constructor(private readonly service: ScheduledCallsService) {}

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(user, from, to);
  }

  @Get('upcoming')
  async upcoming(@CurrentUser() user: User, @Query('limit') limit?: string) {
    await this.service.sendDueReminders();
    return this.service.upcoming(user, limit ? Number(limit) : 10);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateScheduledCallDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledCallDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
