import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantOrmModule } from '../common/tenant-orm.module';
import { DncEntry } from './dnc-entry.entity';
import { DncController } from './dnc.controller';
import { DncService } from './dnc.service';

@Module({
  imports: [TypeOrmModule.forFeature([DncEntry]), TenantOrmModule.forFeature([DncEntry])],
  controllers: [DncController],
  providers: [DncService],
  exports: [DncService],
})
export class DncModule {}
