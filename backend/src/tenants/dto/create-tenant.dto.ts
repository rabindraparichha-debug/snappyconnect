import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { Region, TenantStatus } from '../../common/enums';

export class CreateTenantDto {
  /** Display name, e.g. "Acme Recruiting Inc." */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * URL/domain-safe identifier. Doubles as the tenant's PBX domain, so it is
   * restricted to what is valid in a hostname label.
   */
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, {
    message:
      'slug must be 3-32 characters of lowercase letters, digits or hyphens, and cannot start or end with a hyphen',
  })
  slug: string;

  /** Id of the matching company in the ATS, when provisioned from one. */
  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  seatLimit?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(Region, { each: true })
  regions?: Region[];

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  // --- First administrator, created with the tenant -----------------------
  // A tenant with no way in is useless, so provisioning always seeds one admin.

  @IsString()
  @IsNotEmpty()
  adminName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(8)
  adminPassword: string;
}
