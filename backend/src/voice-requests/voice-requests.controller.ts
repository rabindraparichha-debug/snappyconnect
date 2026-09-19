import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { VoiceRequestsService } from './voice-requests.service';

/** Recruiters submit a sample of their own voice; an admin approves it. */
@ApiTags('Voice requests')
@ApiBearerAuth()
@Controller('voice-requests')
export class VoiceRequestsController {
  constructor(private readonly requests: VoiceRequestsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.requests.list(user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  submit(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { name?: string },
  ) {
    return this.requests.submit(user, body?.name || `${user.name}'s voice`, file);
  }

  @Roles(Role.ADMIN)
  @Post(':id/approve')
  approve(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { provider?: string },
  ) {
    return this.requests.approve(admin, id, body?.provider === 'elevenlabs' ? 'elevenlabs' : 'cartesia');
  }

  @Roles(Role.ADMIN)
  @Post(':id/reject')
  reject(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.requests.reject(admin, id, body?.note);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.remove(user, id);
  }
}
