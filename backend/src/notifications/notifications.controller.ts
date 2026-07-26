import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: User, @Query('limit') limit?: string) {
    return this.service.findForUser(user.id, limit ? Number(limit) : 20);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User) {
    const count = await this.service.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(user.id, id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: User) {
    return this.service.markAllRead(user.id);
  }
}
