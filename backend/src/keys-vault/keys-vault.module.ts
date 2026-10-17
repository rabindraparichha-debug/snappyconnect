import { Global, Module } from '@nestjs/common';
import { KeysVaultService } from './keys-vault.service';

/** Global: every service can inject KeysVaultService without importing the module. */
@Global()
@Module({
  providers: [KeysVaultService],
  exports: [KeysVaultService],
})
export class KeysVaultModule {}
