import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { BATCH_LIMITS, SmsBatchesService } from './sms-batches.service';

class BatchContactDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

class CreateBatchDto {
  /** {{name}} is replaced per recipient. The STOP notice is appended on top. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(BATCH_LIMITS.maxMessageChars)
  message: string;

  @IsISO8601()
  startAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BATCH_LIMITS.maxContacts)
  @ValidateNested({ each: true })
  @Type(() => BatchContactDto)
  contacts: BatchContactDto[];
}

/** Scheduled, dripped bulk messages — strictly limited by design. */
@ApiTags('Scheduled messages')
@ApiBearerAuth()
@Controller('sms/batches')
export class SmsBatchesController {
  constructor(private readonly batches: SmsBatchesService) {}

  @Get('limits')
  limits() {
    return BATCH_LIMITS;
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateBatchDto) {
    return this.batches.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.batches.list(user);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.batches.cancel(user, id);
  }
}
