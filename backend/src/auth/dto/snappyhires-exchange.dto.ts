import { IsString, Length, Matches } from 'class-validator';

/** The mobile app's second leg of "Continue with SnappyHires". */
export class SnappyhiresExchangeDto {
  @IsString()
  @Length(16, 128)
  code: string;

  /** The secret whose base64url SHA-256 the app sent as app_challenge. */
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  verifier: string;
}
