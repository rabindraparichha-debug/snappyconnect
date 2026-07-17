import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CallSource } from '../common/enums';
import { TelnyxProvider } from '../providers/telnyx.provider';
import { User } from '../users/user.entity';
import { CallsService } from './calls.service';
import { CompleteRequestDto } from './dto/complete-request.dto';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { LogCallDto, UpdateCallLogDto } from './dto/log-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { SyncCallsDto } from './dto/sync-calls.dto';

@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly telnyxProvider: TelnyxProvider,
  ) {}

  // ----- Initiation -----

  @Post('initiate')
  initiate(@CurrentUser() user: User, @Body() dto: InitiateCallDto) {
    return this.callsService.initiate(user, dto.phoneNumber, dto.source ?? CallSource.WEB);
  }

  /** Same as initiate, used by the Chrome extension and external apps. */
  @Post('click-to-call')
  clickToCall(@CurrentUser() user: User, @Body() dto: InitiateCallDto) {
    return this.callsService.initiate(user, dto.phoneNumber, dto.source ?? CallSource.EXTENSION);
  }

  /** Short-lived Telnyx WebRTC token for the web/mobile dialer. */
  @Post('telnyx/token')
  telnyxToken(@CurrentUser() user: User) {
    return this.telnyxProvider.createWebRtcToken(user);
  }

  // ----- Client-reported call logs -----

  @Post('log')
  logCall(@CurrentUser() user: User, @Body() dto: LogCallDto) {
    return this.callsService.logCall(user, dto);
  }

  @Patch('log/:id')
  updateLog(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCallLogDto,
  ) {
    return this.callsService.updateLog(user, id, dto);
  }

  // ----- Native-dialer requests (mobile app) -----

  @Get('requests/pending')
  pendingRequests(@CurrentUser() user: User) {
    return this.callsService.pendingRequests(user);
  }

  @Post('requests/:id/ack')
  ackRequest(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.ackRequest(user, id);
  }

  @Post('requests/:id/complete')
  completeRequest(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteRequestDto,
  ) {
    return this.callsService.completeRequest(user, id, dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancelRequest(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.cancelRequest(user, id);
  }

  // ----- Mobile bulk history sync -----

  @Post('sync')
  syncCalls(@CurrentUser() user: User, @Body() dto: SyncCallsDto) {
    return this.callsService.syncCalls(user, dto);
  }

  // ----- History -----

  @Get('export')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @CurrentUser() user: User,
    @Query() query: QueryCallsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="call-history-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return this.callsService.exportCsv(user, query);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: QueryCallsDto) {
    return this.callsService.findAll(user, query);
  }
}
