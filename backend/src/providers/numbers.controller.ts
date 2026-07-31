import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
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
}
