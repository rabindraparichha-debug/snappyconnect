import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import { TelnyxApiService } from './telnyx-api.service';

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
}
