import { jest } from '@jest/globals';
import { BadRequestException, HttpException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { AppException } from '../errors/app.exception.js';
import { GlobalExceptionFilter, errorNameOf } from './global-exception.filter.js';

const fakeResponse = () => {
  const response = { status: jest.fn<(code: number) => unknown>(), json: jest.fn<(body: unknown) => unknown>() };
  response.status.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getResponse: () => response }) };
  return { response, host: host as unknown as ArgumentsHost };
};

describe('전역 예외 필터', () => {
  it('도메인 오류와 프레임워크 오류를 정의서 오류코드로 옮긴다', () => {
    expect(errorNameOf(new AppException('NOT_AVAILABLE'))).toBe('NOT_AVAILABLE');
    expect(errorNameOf(new NotFoundException())).toBe('NOT_FOUND');
    expect(errorNameOf(new BadRequestException())).toBe('BAD_REQUEST');
    expect(errorNameOf(new HttpException('teapot', 418))).toBe('BAD_REQUEST');
    expect(errorNameOf(new HttpException('down', 503))).toBe('INTERNAL_SERVER_ERROR');
    expect(errorNameOf(new Error('boom'))).toBe('INTERNAL_SERVER_ERROR');
  });

  it('본문 파서처럼 status를 단 일반 오류도 요청 쪽 잘못이면 그 상태 코드로 옮긴다', () => {
    const parserError = (status: number) => Object.assign(new Error('parser'), { status });
    expect(errorNameOf(parserError(413))).toBe('PAYLOAD_TOO_LARGE');
    expect(errorNameOf(parserError(415))).toBe('BAD_REQUEST');
    expect(errorNameOf(parserError(500))).toBe('INTERNAL_SERVER_ERROR');
    expect(errorNameOf(Object.assign(new Error('odd'), { status: '413' }))).toBe('INTERNAL_SERVER_ERROR');
  });

  it('실패 엔벌로프에 반환 코드와 메시지를 싣고, 서버 오류만 원인을 로그에 남긴다', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { response, host } = fakeResponse();
    const filter = new GlobalExceptionFilter();

    filter.catch(new AppException('NOT_FOUND'), host);
    expect(response.status).toHaveBeenLastCalledWith(404);
    expect(response.json).toHaveBeenLastCalledWith({
      success: false,
      data: null,
      error: { code: 'E009', message: 'NOT_FOUND' },
    });
    expect(log).not.toHaveBeenCalled();

    filter.catch(new Error('db down'), host);
    expect(response.status).toHaveBeenLastCalledWith(500);
    expect(response.json).toHaveBeenLastCalledWith({
      success: false,
      data: null,
      error: { code: 'E999', message: 'INTERNAL_SERVER_ERROR' },
    });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
