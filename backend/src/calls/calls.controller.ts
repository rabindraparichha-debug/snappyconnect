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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CallSource } from '../common/enums';
import { AsteriskProvider } from '../providers/asterisk.provider';
import { TelnyxProvider } from '../providers/telnyx.provider';
import { User } from '../users/user.entity';
import { CallsService } from './calls.service';
import { CompleteRequestDto } from './dto/complete-request.dto';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { BulkUpdateCallsDto, LogCallDto, UpdateCallLogDto } from './dto/log-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { SyncCallsDto } from './dto/sync-calls.dto';

@ApiTags('Calls')
@ApiBearerAuth()
@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly telnyxProvider: TelnyxProvider,
    private readonly asteriskProvider: AsteriskProvider,
  ) {}

  // ----- Initiation -----

  @Post('initiate')
  initiate(@CurrentUser() user: User, @Body() dto: InitiateCallDto) {
    return this.callsService.initiate(
      user,
      dto.phoneNumber,
      dto.source ?? CallSource.WEB,
      dto.region,
    );
  }

  /** Same as initiate, used by the Chrome extension and external apps. */
  @Post('click-to-call')
  clickToCall(@CurrentUser() user: User, @Body() dto: InitiateCallDto) {
    return this.callsService.initiate(
      user,
      dto.phoneNumber,
      dto.source ?? CallSource.EXTENSION,
      dto.region,
    );
  }

  /** Short-lived Telnyx WebRTC token for the web/mobile dialer. */
  @Post('telnyx/token')
  telnyxToken(@CurrentUser() user: User) {
    return this.telnyxProvider.createWebRtcToken(user);
  }

  /** SIP connection details for the mobile app's built-in Asterisk softphone (UAE). */
  @Get('asterisk/config')
  asteriskConfig(@CurrentUser() user: User) {
    return this.asteriskProvider.getClientConfig(user);
  }

  // ----- Client-reported call logs -----

  @Post('log')
  logCall(@CurrentUser() user: User, @Body() dto: LogCallDto) {
    return this.callsService.logCall(user, dto);
  }

  @Patch('bulk')
  bulkUpdate(@CurrentUser() user: User, @Body() dto: BulkUpdateCallsDto) {
    return this.callsService.bulkUpdate(user, dto);
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

  // ----- Contacts timeline -----

  @Get('contacts')
  contacts(
    @CurrentUser() user: User,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.callsService.contacts(user, {
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('contacts/:phoneNumber')
  contactHistory(
    @CurrentUser() user: User,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    return this.callsService.contactHistory(user, decodeURIComponent(phoneNumber));
  }

  // ----- Follow-ups -----

  @Get('follow-ups')
  followUps(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
  ) {
    return this.callsService.upcomingFollowUps(user, limit ? Number(limit) : 10);
  }

  // ----- Recording upload -----

  @Post('log/:id/recording')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = process.env.RECORDINGS_DIR || '/opt/snappyconnect/recordings';
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
          cb(null, unique + extname(file.originalname));
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async uploadRecording(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const url = `/api/v1/calls/recordings/${file.filename}`;
    await this.callsService.updateLog(user, id, { recordingUrl: url });
    return { recordingUrl: url };
  }

  @Get('recordings/:filename')
  serveRecording(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const dir = process.env.RECORDINGS_DIR || '/opt/snappyconnect/recordings';
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = join(dir, safeName);
    if (!existsSync(filePath)) {
      res.status(404).json({ message: 'Recording not found' });
      return;
    }
    res.sendFile(filePath);
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
