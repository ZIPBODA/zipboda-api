import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.schema.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
await app.listen(app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true }));
