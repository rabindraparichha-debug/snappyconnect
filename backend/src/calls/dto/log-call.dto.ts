import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CallDirection, CallDisposition, CallSource, CallStatus, Region } from '../../common/enums';

export class LogCallDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsEnum(CallDirection)
  direction?: CallDirection;

  @IsEnum(CallStatus)
  status: CallStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  // Phase 1 enrichment fields

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(CallSource)
  source?: CallSource;

  @IsOptional()
  @IsInt()
  @Min(0)
  ringTimeSeconds?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;
}

export class BulkUpdateCallsDto {
  @IsNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEnum(CallDisposition)
  disposition?: CallDisposition;
}

export class UpdateCallLogDto {
  @IsOptional()
  @IsEnum(CallStatus)
  status?: CallStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  recordingUrl?: string;

  @IsOptional()
  @IsString()
  aiSummary?: string;

  @IsOptional()
  @IsString()
  transcript?: string;

  @IsOptional()
  @IsEnum(CallDisposition)
  disposition?: CallDisposition;
}
