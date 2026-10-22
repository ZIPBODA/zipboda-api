import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_GLOBAL_PREFIX } from './common/constants/http.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { createValidationPipe } from './common/pipes/create-validation-pipe.js';
import type { Env } from './config/env.schema.js';

/** 실행 서버와 e2e 테스트가 같은 설정으로 뜨게 한 곳에 모은다 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // 서버 프레임워크를 응답 헤더로 알리지 않는다
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }) });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.enableShutdownHooks();
}
