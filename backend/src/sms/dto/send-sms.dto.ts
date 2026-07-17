import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SendSmsDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[+\d][\d\s\-().]{4,19}$/, { message: 'to must be a valid phone number' })
  to: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1600)
  body: string;
}
