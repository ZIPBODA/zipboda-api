import { ValidationPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception.js';

/** DTO 검증 실패는 정의서의 유효성 오류(ERR-005)다. 정의하지 않은 필드는 받지 않는다 */
export const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new AppException('VALIDATION_ERROR'),
  });
