import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CallingProvider, Region, Role, UserStatus } from '../../common/enums';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(CallingProvider)
  provider?: CallingProvider;

  @IsOptional()
  @IsArray()
  @IsEnum(Region, { each: true })
  regions?: Region[];

  @IsOptional()
  @IsObject()
  providerConfig?: Record<string, any>;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
