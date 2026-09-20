import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantOrmModule } from '../common/tenant-orm.module';
import { ProvidersModule } from '../providers/providers.module';
import { TenantsModule } from '../tenants/tenants.module';
import { User } from './user.entity';
import { ProfileController } from './profile.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    TenantOrmModule.forFeature([User]),
    ProvidersModule,
    TenantsModule,
  ],
  controllers: [UsersController, ProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
