import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantOrmModule } from '../common/tenant-orm.module';
import { CallLog } from '../calls/call-log.entity';
import { User } from '../users/user.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, CallLog]), TenantOrmModule.forFeature([User, CallLog])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
