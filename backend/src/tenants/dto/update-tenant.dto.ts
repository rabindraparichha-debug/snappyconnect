import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Region, TenantStatus } from '../../common/enums';

/**
 * `slug` is deliberately absent: it is the tenant's PBX domain and appears in
 * provisioned provider config, so renaming it is a migration, not an edit.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

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
}
