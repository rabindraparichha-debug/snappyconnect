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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { CreateCallScriptDto, UpdateCallScriptDto } from './dto/call-script.dto';
import { ScriptsService } from './scripts.service';

@ApiTags('Call Scripts')
@ApiBearerAuth()
@Controller('scripts')
export class ScriptsController {
  constructor(private readonly service: ScriptsService) {}

  @Get()
  findAll(@CurrentUser() user: User, @Query('all') all?: string) {
    const includeInactive = user.role === Role.ADMIN && all === 'true';
    return this.service.findAll(includeInactive);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateCallScriptDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCallScriptDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
