import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  stats(@CurrentUser() user: User) {
    return this.dashboardService.stats(user);
  }

  @Get('search')
  search(@CurrentUser() user: User, @Query('q') q: string) {
    return this.dashboardService.search(user, q);
  }
}
