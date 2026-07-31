import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import { AsteriskAmiService } from './asterisk-ami.service';
import { TelnyxApiService } from './telnyx-api.service';

/** {options} is replaced with the live extension list when the call comes in. */
export const DEFAULT_GREETING =
  'Welcome to SnappyHires. {options} If you know the extension, please press it now, ' +
  'or stay on the line and an operator will answer.';

class BuyNumberDto {
  @Matches(/^\d{3}$/, { message: 'areaCode must be 3 digits' })
  areaCode: string;

  /** A specific number from the search results; omit to take the first match. */
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

class BoardLineDto {
  @IsString()
  phoneNumber: string;
}

class ExtensionDto {
  @IsString()
  userId: string;

  @Matches(/^[1-9]$/, { message: 'digit must be 1-9' })
  digit: string;
}

/** The Dinstar's eight SIM slots. */
export const SIM_PORTS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Recruiters per SIM — three extensions share each SIM card. */
export const EXTENSIONS_PER_SIM_PORT = 3;

/** First SIP extension in the recruiter range. */
const FIRST_EXTENSION = 2001;

/** The three extensions that dial out on a given SIM port. */
export function simPortExtensions(port: number): string[] {
  const base = FIRST_EXTENSION + (port - 1) * EXTENSIONS_PER_SIM_PORT;
  return Array.from({ length: EXTENSIONS_PER_SIM_PORT }, (_, i) => String(base + i));
}

/** Which SIM port an extension belongs to, or null if it is outside the range. */
export function simPortForExtension(exten: string): number | null {
  if (!/^\d+$/.test(exten)) return null;
  const offset = Number(exten) - FIRST_EXTENSION;
  if (offset < 0) return null;
  const port = Math.floor(offset / EXTENSIONS_PER_SIM_PORT) + 1;
  return SIM_PORTS.includes(port) ? port : null;
}

class SimPortLabelDto {
  @IsInt()
  @Min(1)
  @Max(SIM_PORTS.length)
  port: number;

  /** The SIM's own number, for the admin's reference. Empty clears it. */
  @IsString()
  label: string;
}

class SimPinningDto {
  @IsBoolean()
  enabled: boolean;
}

class AssignSimExtensionDto {
  @IsString()
  userId: string;

  @Matches(/^\d{4}$/, { message: 'exten must be a 4-digit extension' })
  exten: string;
}

class IvrSettingsDto {
  /** Spoken greeting. {options} expands to the live extension list. */
  @IsOptional()
  @IsString()
  ivrGreeting?: string;

  /** User who answers when the caller presses nothing ("the operator"). */
  @IsOptional()
  @IsString()
  operatorUserId?: string;
}

class RecordingSettingsDto {
  @IsBoolean()
  usaEnabled: boolean;
}

/**
 * Admin view of the Telnyx numbers on the account: who owns each one, which
 * one answers as the board line, and buying more — so phone-system changes
 * don't need the Telnyx portal.
 */
@ApiTags('Phone numbers')
@ApiBearerAuth()
@Controller('numbers')
@Roles(Role.ADMIN)
export class NumbersController {
  constructor(
    private readonly telnyx: TelnyxApiService,
    private readonly settings: SettingsService,
    private readonly ami: AsteriskAmiService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /** Every number on the account with what it is used for. */
  @Get()
  async list() {
    const [numbers, users, cfg] = await Promise.all([
      this.telnyx.listNumbers(),
      this.usersRepo.find(),
      this.settings.getProviderSettings('telnyx'),
    ]);

    const owners = new Map<string, User>();
    for (const user of users) {
      const number = user.providerConfig?.telnyxNumber;
      if (number) owners.set(number, user);
    }

    return numbers.map((n) => {
      const owner = owners.get(n.phoneNumber);
      return {
        phoneNumber: n.phoneNumber,
        connectionId: n.connectionId,
        assignedTo: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
        isBoardLine: cfg.boardLineNumber === n.phoneNumber,
        isDefaultCallerId: cfg.fromNumber === n.phoneNumber,
      };
    });
  }

  /** Numbers for sale in an area code (nothing is bought until you pick one). */
  @Get('available')
  search(@Query('areaCode') areaCode = '332') {
    return this.telnyx.searchAvailable(areaCode);
  }

  @Post('buy')
  async buy(@Body() dto: BuyNumberDto) {
    const phoneNumber = await this.telnyx.purchaseNumber(dto.areaCode, dto.phoneNumber);
    return { phoneNumber };
  }

  /**
   * Point a number at the IVR: creates the Call Control application on first
   * use, attaches the number to it, and remembers it as the board line.
   */
  @Post('board-line')
  async setBoardLine(@Body() dto: BoardLineDto) {
    const cfg = await this.settings.getProviderSettings('telnyx');
    const webhookUrl = `${process.env.PUBLIC_API_URL ?? 'https://call.snappyhires.com/api/v1'}/webhooks/telnyx-voice`;

    let appId: string | undefined = cfg.callControlAppId;
    if (!appId) {
      const existing = await this.telnyx.listCallControlApps();
      appId = existing.find((a) => a.webhookUrl === webhookUrl)?.id;
    }
    if (!appId) {
      const created = await this.telnyx.createCallControlApp('SnappyConnect IVR', webhookUrl);
      appId = created.id;
    }

    await this.telnyx.assignNumberToConnection(dto.phoneNumber, appId);
    await this.settings.updateProviderSettings('telnyx', {
      callControlAppId: appId,
      boardLineNumber: dto.phoneNumber,
    });
    return { phoneNumber: dto.phoneNumber, callControlAppId: appId, webhookUrl };
  }

  // ----- Call recording -----

  /** Whether USA (Telnyx) calls are recorded. UAE records on our own PBX. */
  @Get('recording')
  async recordingSettings() {
    const cfg = await this.settings.getProviderSettings('telnyx');
    return {
      usaEnabled: Boolean(cfg.recordingEnabled),
      uaeEnabled: true,
      note: 'UAE calls record on the SnappyConnect PBX; USA calls record at Telnyx and are copied to your storage server.',
    };
  }

  @Post('recording')
  async setRecording(@Body() dto: RecordingSettingsDto) {
    const profiles = await this.telnyx.listOutboundVoiceProfiles();
    for (const profile of profiles) {
      await this.telnyx.setOutboundRecording(profile.id, dto.usaEnabled);
    }
    await this.settings.updateProviderSettings('telnyx', { recordingEnabled: dto.usaEnabled });
    return this.recordingSettings();
  }

  // ----- Board-line extensions & greeting -----

  /** Everything the board line needs: greeting, operator, and the menu. */
  @Get('ivr')
  async ivr() {
    const [cfg, users] = await Promise.all([
      this.settings.getProviderSettings('telnyx'),
      this.usersRepo.find(),
    ]);

    const extensions = users
      .filter((u) => u.providerConfig?.ivrDigit)
      .map((u) => ({
        digit: String(u.providerConfig.ivrDigit),
        userId: u.id,
        name: u.name,
        email: u.email,
        ringsTo: u.providerConfig?.telnyxNumber ?? u.mobileNumber ?? null,
      }))
      .sort((a, b) => a.digit.localeCompare(b.digit));

    return {
      boardLineNumber: cfg.boardLineNumber ?? null,
      greeting: cfg.ivrGreeting ?? DEFAULT_GREETING,
      operatorUserId: cfg.operatorUserId ?? null,
      extensions,
    };
  }

  @Post('ivr')
  async updateIvr(@Body() dto: IvrSettingsDto) {
    await this.settings.updateProviderSettings('telnyx', {
      ...(dto.ivrGreeting !== undefined ? { ivrGreeting: dto.ivrGreeting } : {}),
      ...(dto.operatorUserId !== undefined ? { operatorUserId: dto.operatorUserId } : {}),
    });
    return this.ivr();
  }

  /** Give a user a menu digit (replacing whoever held it). */
  @Post('extensions')
  async setExtension(@Body() dto: ExtensionDto) {
    const user = await this.usersRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('User not found');

    const holder = await this.usersRepo.find();
    for (const other of holder) {
      if (other.id !== user.id && String(other.providerConfig?.ivrDigit) === dto.digit) {
        other.providerConfig = { ...(other.providerConfig ?? {}), ivrDigit: undefined };
        delete other.providerConfig.ivrDigit;
        await this.usersRepo.save(other);
      }
    }

    user.providerConfig = { ...(user.providerConfig ?? {}), ivrDigit: dto.digit };
    await this.usersRepo.save(user);
    return this.ivr();
  }

  @Delete('extensions/:userId')
  async removeExtension(@Param('userId') userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (user) {
      const cfg = { ...(user.providerConfig ?? {}) };
      delete cfg.ivrDigit;
      user.providerConfig = cfg;
      await this.usersRepo.save(user);
    }
    return this.ivr();
  }

  // ----- Dinstar SIM ports (UAE) -----

  /**
   * The eight Dinstar SIM slots, each with the three SIP extensions that dial
   * out on it and whoever holds them. Labels (the SIM's own number) are admin
   * -entered; the extension numbering is fixed by `simPortExtensions`.
   */
  @Get('sim-ports')
  async simPorts() {
    const [users, cfg] = await Promise.all([
      this.usersRepo.find(),
      this.settings.getProviderSettings('dinstar'),
    ]);
    const labels: Record<string, string> = cfg.simPortLabels ?? {};

    return {
      // Pinning rides the UCM's `_8X.` outbound route. Until that exists a
      // pinned call is answered with 404, so the UI warns before assigning.
      pinningReady: cfg.pinningReady === true,
      ports: SIM_PORTS.map((port) => ({
        port,
        label: labels[String(port)] ?? '',
        extensions: simPortExtensions(port).map((exten) => {
          const holder = users.find((u) => u.providerConfig?.sipUsername === exten);
          return {
            exten,
            userId: holder?.id ?? null,
            userName: holder?.name ?? null,
            // A pinned recruiter with no SIP password cannot register at all.
            missingSipPassword: holder ? !holder.providerConfig?.sipPassword : false,
          };
        }),
      })),
    };
  }

  /** Record the SIM card's own number against a port, for the admin's reference. */
  @Post('sim-ports/label')
  async setSimPortLabel(@Body() dto: SimPortLabelDto) {
    const cfg = await this.settings.getProviderSettings('dinstar');
    const labels: Record<string, string> = { ...(cfg.simPortLabels ?? {}) };
    if (dto.label) labels[String(dto.port)] = dto.label;
    else delete labels[String(dto.port)];
    await this.settings.updateProviderSettings('dinstar', { simPortLabels: labels });
    return this.simPorts();
  }

  /** Turn SIM pinning on once the UCM `_8X.` route and Dinstar rules exist. */
  @Post('sim-ports/pinning')
  async setPinning(@Body() dto: SimPinningDto) {
    await this.settings.updateProviderSettings('dinstar', { pinningReady: dto.enabled });
    // Push every stored assignment into (or out of) Asterisk so the switch
    // takes effect immediately rather than on each recruiter's next edit.
    const users = await this.usersRepo.find();
    for (const u of users) {
      const exten: string | undefined = u.providerConfig?.sipUsername;
      const port: number | undefined = u.providerConfig?.simPort;
      if (!exten || !port) continue;
      await (dto.enabled
        ? this.ami.setSimPort(exten, port)
        : this.ami.clearSimPort(exten)
      ).catch(() => undefined);
    }
    return this.simPorts();
  }

  /**
   * Give a recruiter one of a port's extensions. This both assigns the SIP
   * account and pins their outbound calls to that SIM, so the two can never
   * drift apart. Whoever held the extension is released first.
   */
  @Post('sim-ports/assign')
  async assignSimExtension(@Body() dto: AssignSimExtensionDto) {
    const port = simPortForExtension(dto.exten);
    if (port === null) {
      throw new BadRequestException(`${dto.exten} is not a SIM port extension`);
    }

    const user = await this.usersRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('User not found');

    const everyone = await this.usersRepo.find();
    for (const other of everyone) {
      if (other.id === user.id) continue;
      if (other.providerConfig?.sipUsername !== dto.exten) continue;
      const cfg = { ...(other.providerConfig ?? {}) };
      delete cfg.sipUsername;
      delete cfg.simPort;
      other.providerConfig = cfg;
      await this.usersRepo.save(other);
    }

    // Release the extension this user held before, so no stale pin is left
    // behind in Asterisk pointing their old line at a SIM.
    const previous: string | undefined = user.providerConfig?.sipUsername;
    if (previous && previous !== dto.exten) {
      await this.ami.clearSimPort(previous).catch(() => undefined);
    }

    user.providerConfig = {
      ...(user.providerConfig ?? {}),
      sipUsername: dto.exten,
      simPort: port,
    };
    await this.usersRepo.save(user);
    await this.pushSimPin(dto.exten, port);
    return this.simPorts();
  }

  /** Take an extension back; the holder keeps their account but loses the SIP line. */
  @Delete('sim-ports/assign/:exten')
  async unassignSimExtension(@Param('exten') exten: string) {
    if (simPortForExtension(exten) === null) {
      throw new BadRequestException(`${exten} is not a SIM port extension`);
    }
    const holder = (await this.usersRepo.find()).find(
      (u) => u.providerConfig?.sipUsername === exten,
    );
    if (holder) {
      const cfg = { ...(holder.providerConfig ?? {}) };
      delete cfg.sipUsername;
      delete cfg.simPort;
      holder.providerConfig = cfg;
      await this.usersRepo.save(holder);
    }
    await this.ami.clearSimPort(exten).catch(() => undefined);
    return this.simPorts();
  }

  /**
   * Push the pin into Asterisk, but only while pinning is switched on — with
   * the UCM route missing, a pinned call fails outright whereas an unpinned
   * one completes over the shared pool. The assignment is still stored either
   * way, so switching pinning on later needs no reassignment.
   */
  private async pushSimPin(exten: string, port: number): Promise<void> {
    const cfg = await this.settings.getProviderSettings('dinstar');
    const action =
      cfg.pinningReady === true
        ? this.ami.setSimPort(exten, port)
        : this.ami.clearSimPort(exten);
    await action.catch(() => undefined);
  }
}
