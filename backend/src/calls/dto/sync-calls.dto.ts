import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CallDirection, CallStatus } from '../../common/enums';

export class SyncCallItemDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsEnum(CallDirection)
  direction: CallDirection;

  @IsEnum(CallStatus)
  status: CallStatus;

  @IsInt()
  @Min(0)
  durationSeconds: number;

  @IsDateString()
  startedAt: string;
}

/** Bulk call-history sync from the mobile app (native dialer provider). */
export class SyncCallsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncCallItemDto)
  calls: SyncCallItemDto[];
}
