import { Body, Controller, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './user.entity';
import { UsersService } from './users.service';

class MyVoicemailDto {
  /** Spoken to callers who reach voicemail; blank restores the generic one. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  voicemailGreeting?: string;

  /** How long the browser rings before voicemail takes over. */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  ringSeconds?: number;
}

/**
 * Self-service settings — things a recruiter manages about their own line
 * without needing an admin. (The admin Users/Numbers pages can still override.)
 */
@ApiTags('Profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('voicemail')
  updateVoicemail(@CurrentUser() user: User, @Body() dto: MyVoicemailDto) {
    return this.usersService.updateOwnVoicemail(user.id, dto);
  }
}
