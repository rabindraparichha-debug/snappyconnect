import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { CallSource, Region } from '../../common/enums';

export class InitiateCallDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[+\d][\d\s\-().]{4,19}$/, { message: 'phoneNumber must be a valid phone number' })
  phoneNumber: string;

  @IsOptional()
  @IsEnum(CallSource)
  source?: CallSource;

  /** Which regional line to call from. Defaults to the number's dial code. */
  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}
