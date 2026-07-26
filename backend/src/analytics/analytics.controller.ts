import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('recruiter')
  recruiterStats(@CurrentUser() user: User, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.recruiterStats(user, query);
  }

  @Get('recruiter/trend')
  recruiterTrend(
    @CurrentUser() user: User,
    @Query() query: AnalyticsQueryDto,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    return this.analyticsService.recruiterTrend(user, query, granularity);
  }

  @Get('team')
  @Roles(Role.ADMIN)
  teamStats(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.teamStats(query);
  }

  @Get('team/leaderboard')
  @Roles(Role.ADMIN)
  leaderboard(
    @Query() query: AnalyticsQueryDto,
    @Query('metric') metric?: 'calls' | 'connected' | 'talkTime',
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.leaderboard(query, metric, limit ? Number(limit) : 10);
  }

  @Get('team/trend')
  @Roles(Role.ADMIN)
  teamTrend(
    @Query() query: AnalyticsQueryDto,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    return this.analyticsService.teamTrend(query, granularity);
  }
}
