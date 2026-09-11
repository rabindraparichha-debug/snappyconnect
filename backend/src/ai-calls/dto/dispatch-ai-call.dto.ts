import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Region } from '../../common/enums';

export class DispatchAiCallDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  /** What the agent should achieve on the call. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goalPrompt?: string;

  /** Opening line; {{contactName}} and {{companyName}} are substituted. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scriptTemplate?: string;

  /** Force a region; otherwise guessed from the number's dial code. */
  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}
