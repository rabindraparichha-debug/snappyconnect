import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DncService } from '../dnc/dnc.service';
import { User } from '../users/user.entity';
import { ContactItemStatus } from './contact-list.entity';
import { ContactListsService } from './contact-lists.service';
import {
  CreateContactListDto,
  ImportCsvDto,
  UpdateContactItemDto,
  UpdateContactListDto,
} from './dto/contact-list.dto';

@ApiTags('Contact Lists')
@ApiBearerAuth()
@Controller('contact-lists')
export class ContactListsController {
  constructor(
    private readonly service: ContactListsService,
    private readonly dnc: DncService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.service.findAll(user);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateContactListDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateContactListDto) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.remove(user, id);
  }

  @Get(':id/items')
  items(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('status') status?: ContactItemStatus,
  ) {
    return this.service.items(user, id, status);
  }

  @Get(':id/progress')
  progress(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.progress(user, id);
  }

  @Get(':id/next')
  next(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.nextPending(user, id);
  }

  @Post(':id/import')
  import(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ImportCsvDto) {
    return this.service.importCsv(user, id, dto, (phone) => this.dnc.isBlocked(phone));
  }

  @Post(':id/reset')
  reset(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.resetList(user, id);
  }

  @Patch('items/:itemId')
  updateItem(
    @CurrentUser() user: User,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateContactItemDto,
  ) {
    return this.service.updateItem(user, itemId, dto);
  }

  @Delete('items/:itemId')
  removeItem(@CurrentUser() user: User, @Param('itemId') itemId: string) {
    return this.service.removeItem(user, itemId);
  }
}
