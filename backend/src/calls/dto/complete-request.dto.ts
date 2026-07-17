import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CallStatus } from '../../common/enums';

/** Mobile app reports the outcome of a dispatched native-dialer call request. */
export class CompleteRequestDto {
  @IsEnum(CallStatus)
  status: CallStatus;

  @IsInt()
  @Min(0)
  durationSeconds: number;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
