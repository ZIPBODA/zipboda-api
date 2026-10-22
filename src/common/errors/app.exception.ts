import { ERROR_CODES, type ErrorName } from './error-codes.js';

/** 도메인에서 던지는 예상된 오류. 전역 예외 필터가 오류코드(ERR-*)와 상태 코드로 바꾼다 */
export class AppException extends Error {
  constructor(readonly errorName: ErrorName) {
    super(errorName);
    this.name = 'AppException';
  }

  get status(): number {
    return ERROR_CODES[this.errorName].status;
  }
}
