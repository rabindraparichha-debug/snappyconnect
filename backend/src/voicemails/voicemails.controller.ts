import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { VoicemailsService } from './voicemails.service';

/** Messages left when a recruiter's line went unanswered. */
@ApiTags('Voicemail')
@ApiBearerAuth()
@Controller('voicemails')
export class VoicemailsController {
  constructor(private readonly voicemails: VoicemailsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.voicemails.list(user);
  }

  /** Drives the unread badge without shipping the whole list. */
  @Get('unread-count')
  async unread(@CurrentUser() user: User) {
    return { count: await this.voicemails.unreadCount(user) };
  }

  @Patch(':id/read')
  setRead(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { read?: boolean },
  ) {
    return this.voicemails.setRead(user, id, body?.read !== false);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.voicemails.remove(user, id);
  }
}
