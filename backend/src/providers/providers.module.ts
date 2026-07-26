import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallLog } from '../calls/call-log.entity';
import { CallRequest } from '../calls/call-request.entity';
import { User } from '../users/user.entity';
import { SettingsModule } from '../settings/settings.module';
import { AsteriskAmiService } from './asterisk-ami.service';
import { AsteriskCdrService } from './asterisk-cdr.service';
import { AsteriskProvider } from './asterisk.provider';
import { GrandstreamProvider } from './grandstream.provider';
import { NativeDialerProvider } from './native-dialer.provider';
import { ProvidersService } from './providers.service';
import { TelnyxApiService } from './telnyx-api.service';
import { TelnyxProvisioningService } from './telnyx-provisioning.service';
import { TelnyxProvider } from './telnyx.provider';

@Module({
  imports: [SettingsModule, TypeOrmModule.forFeature([CallLog, CallRequest, User])],
  providers: [
    ProvidersService,
    TelnyxProvider,
    GrandstreamProvider,
    NativeDialerProvider,
    AsteriskProvider,
    AsteriskAmiService,
    AsteriskCdrService,
    TelnyxApiService,
    TelnyxProvisioningService,
  ],
  exports: [
    ProvidersService,
    TelnyxProvider,
    AsteriskProvider,
    TelnyxApiService,
    TelnyxProvisioningService,
  ],
})
export class ProvidersModule {}
