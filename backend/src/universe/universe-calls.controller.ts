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
import { InjectRepository } from '@nestjs/typeorm';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Repository } from 'typeorm';
import { CallLog } from '../calls/call-log.entity';
import { Public } from '../common/decorators/public.decorator';
import { buildPage, clampLimit, decodeCursor, FeedRow } from './universe-calls';
import { verifyUniverseServiceToken } from './universe-token';

/**
 * GET /api/v1/universe/calls?cursor=&limit= — the call-history feed the
 * SnappyHires ATS pulls into its recruiter-wise calls report.
 *
 * Every call, every user, oldest change first, keyset-paged on
 * (updatedAt, id): a disposition set after the call re-delivers the row.
 * Contact details, notes, transcripts and recordings never leave here (see
 * FeedCall in universe-calls.ts).
 *
 * @Public only switches off the SnappyConnect session guard; the route is
 * closed by the universe service token, exactly like /universe/people.
 */
@ApiExcludeController()
@Controller('universe')
export class UniverseCallsController {
  constructor(
    @InjectRepository(CallLog) private readonly calls: Repository<CallLog>,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('calls')
  async feed(
    @Headers('authorization') authorization?: string,
    @Query('cursor') cursorRaw?: unknown,
    @Query('limit') limitRaw?: unknown,
  ) {
    const secret = (this.config.get<string>('UNIVERSE_JWT_SECRET') ?? '').trim();
    if (!secret) throw new HttpException({ error: 'not configured' }, 503);

    const match = /^Bearer\s+(\S+)$/i.exec((authorization ?? '').trim());
    const verdict = match
      ? verifyUniverseServiceToken(match[1], secret)
      : ({ ok: false, reason: 'missing' } as const);
    // One answer for every failure: the caller learns nothing about why.
    if (!verdict.ok) throw new UnauthorizedException({ error: 'unauthorized' });

    let cursor = null;
    if (cursorRaw !== undefined && cursorRaw !== '') {
      cursor = decodeCursor(cursorRaw);
      if (!cursor) throw new UnprocessableEntityException({ error: 'invalid cursor' });
    }
    const limit = clampLimit(limitRaw);

    // to_char keeps the microseconds the keyset comparison needs.
    const rows: FeedRow[] = await this.calls.query(
      `select c.id,
              c."userId",
              u.name  as "userName",
              u.email as "userEmail",
              c.direction::text   as direction,
              c.status::text      as status,
              c.disposition,
              c."durationSeconds",
              c."ringTimeSeconds",
              c.region::text      as region,
              c.source::text      as source,
              c."startedAt",
              c."endedAt",
              to_char(c."updatedAt" at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTs"
         from call_logs c
         left join users u on u.id = c."userId"
        where $1::timestamptz is null
           or (c."updatedAt", c.id) > ($1::timestamptz, $2::uuid)
        order by c."updatedAt", c.id
        limit $3`,
      [cursor?.t ?? null, cursor?.i ?? null, limit + 1],
    );

    return buildPage(rows, limit);
  }
}
