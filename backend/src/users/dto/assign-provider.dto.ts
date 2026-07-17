import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { CallingProvider } from '../../common/enums';

export class AssignProviderDto {
  @IsEnum(CallingProvider)
  provider: CallingProvider;

  @IsOptional()
  @IsObject()
  providerConfig?: Record<string, any>;
}
