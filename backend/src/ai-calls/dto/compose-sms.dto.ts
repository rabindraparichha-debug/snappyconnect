import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ComposeSmsDto {
  /** The recruiter's rough brief: the role, or the pitch. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  context: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  /**
   * Character budget for the draft. Defaults to 140 so the opt-out line the
   * sender appends still fits inside one 160-character segment.
   */
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(300)
  maxChars?: number;
}
