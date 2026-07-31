import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CallDirection, CallDisposition, CallingProvider, CallStatus } from '../../common/enums';

export class QueryCallsDto {
  /** Free-text search over phone number and user name/email. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(CallingProvider)
  provider?: CallingProvider;

  @IsOptional()
  @IsEnum(CallDirection)
  direction?: CallDirection;

  @IsOptional()
  @IsEnum(CallStatus)
  status?: CallStatus;

  @IsOptional()
  @IsEnum(CallDisposition)
  disposition?: CallDisposition;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Only calls that have an audio recording attached. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasRecording?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 20;
}
