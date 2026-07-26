import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Region } from '../../common/enums';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}
