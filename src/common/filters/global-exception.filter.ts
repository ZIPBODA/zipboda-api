import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from '../errors/app.exception.js';
import { ERROR_CODES, type ErrorName } from '../errors/error-codes.js';
import { errorEnvelope } from '../http/api-envelope.js';

/** 프레임워크가 직접 던지는 오류(없는 경로·잘못된 JSON·너무 큰 본문 등)의 상태 코드를 오류코드로 옮긴다 */
const ERROR_NAME_BY_STATUS: Partial<Record<number, ErrorName>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

const SERVER_ERROR_MIN_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * 본문 파서(body-parser) 오류는 HttpException이 아니라 status를 단 일반 Error로 온다.
 * 이를 놓치면 너무 큰 본문·잘못된 문자셋 같은 요청 쪽 잘못이 500과 오류 로그로 남는다
 */
const statusOf = (exception: unknown): number | null => {
  if (exception instanceof HttpException) return exception.getStatus();
  if (exception instanceof Error && 'status' in exception && typeof exception.status === 'number') {
    return exception.status;
  }
  return null;
};

export const errorNameOf = (exception: unknown): ErrorName => {
  if (exception instanceof AppException) return exception.errorName;
  const status = statusOf(exception);
  if (status === null || status >= SERVER_ERROR_MIN_STATUS) return 'INTERNAL_SERVER_ERROR';
  return ERROR_NAME_BY_STATUS[status] ?? 'BAD_REQUEST';
};

/** 원인(스택)은 응답에 싣지 않고 서버 로그에만 남긴다 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const errorName = errorNameOf(exception);
    const { status } = ERROR_CODES[errorName];
    if (status >= SERVER_ERROR_MIN_STATUS) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    host.switchToHttp().getResponse<Response>().status(status).json(errorEnvelope(errorName));
  }
}
