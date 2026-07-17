import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CallingProvider, UserStatus } from '../../common/enums';

export class QueryUsersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(CallingProvider)
  provider?: CallingProvider;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
