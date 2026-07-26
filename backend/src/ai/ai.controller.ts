import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AiService, ChatMessage } from './ai.service';

class MessageDto {
  @IsEnum(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content: string;
}

class ChatDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];
}

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(@Body() dto: ChatDto) {
    return this.aiService.chat(dto.messages as ChatMessage[]);
  }
}
