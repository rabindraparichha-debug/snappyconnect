import {
  Controller,
  Get,
  Headers,
  HttpException,
  Query,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CarePeopleCard, CarePeopleService, phoneDigits } from './care-people.service';
import { verifyUniverseServiceToken } from './universe-token';

/**
 * GET /api/v1/universe/people — staff-support person lookup for Snappy Care.
 * See docs/care-people.md.
 *
 * @Public only switches off the SnappyConnect session guard; the route is
 * closed by the universe service token checked below.
 */
@ApiExcludeController()
@Controller('universe')
export class UniversePeopleController {
  constructor(
    private readonly people: CarePeopleService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('people')
  async lookup(
    @Headers('authorization') authorization?: string,
    @Query('universe_id') universeId?: unknown,
    @Query('email') email?: unknown,
    @Query('phone') phone?: unknown,
  ): Promise<CarePeopleCard> {
    const secret = (this.config.get<string>('UNIVERSE_JWT_SECRET') ?? '').trim();
    if (!secret) throw new HttpException({ error: 'not configured' }, 503);

    const match = /^Bearer\s+(\S+)$/i.exec((authorization ?? '').trim());
    const verdict = match
      ? verifyUniverseServiceToken(match[1], secret)
      : ({ ok: false, reason: 'missing' } as const);
    // One answer for every failure: the caller learns nothing about why.
    if (!verdict.ok) throw new UnauthorizedException({ error: 'unauthorized' });

    const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 320) : '');
    const query = { universeId: str(universeId), email: str(email), phone: str(phone) };
    if (query.phone && !phoneDigits(query.phone)) query.phone = '';
    if (query.email && !/^[^\s@]+@[^\s@]+$/.test(query.email)) query.email = '';
    if (!query.universeId && !query.email && !query.phone) {
      throw new UnprocessableEntityException({
        error: 'universe_id, email or phone is required',
      });
    }
    return this.people.lookup(query);
  }
}
