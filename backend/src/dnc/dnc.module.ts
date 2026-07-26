import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DncEntry } from './dnc-entry.entity';
import { DncController } from './dnc.controller';
import { DncService } from './dnc.service';

@Module({
  imports: [TypeOrmModule.forFeature([DncEntry])],
  controllers: [DncController],
  providers: [DncService],
  exports: [DncService],
})
export class DncModule {}
