import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DncModule } from '../dnc/dnc.module';
import { ContactList, ContactListItem } from './contact-list.entity';
import { ContactListsController } from './contact-lists.controller';
import { ContactListsService } from './contact-lists.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContactList, ContactListItem]), DncModule],
  controllers: [ContactListsController],
  providers: [ContactListsService],
  exports: [ContactListsService],
})
export class ContactListsModule {}
