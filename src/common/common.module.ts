import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@/config/env.schema.js';
import { AccessTokenService } from './security/access-token.service.js';
import { PiiCipher } from './security/pii-cipher.js';
import { Clock, SystemClock } from './time/clock.js';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    AccessTokenService,
    {
      provide: PiiCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PiiCipher(
          Buffer.from(config.get('PII_ENCRYPTION_KEY', { infer: true }), 'base64'),
          Buffer.from(config.get('PII_HASH_KEY', { infer: true }), 'base64'),
        ),
    },
  ],
  exports: [Clock, AccessTokenService, PiiCipher],
})
export class CommonModule {}
