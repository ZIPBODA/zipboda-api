import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

const handlerReturning = (value: unknown): CallHandler<unknown> => ({ handle: () => of(value) });
const context = {} as ExecutionContext;

describe('응답 엔벌로프', () => {
  it('컨트롤러가 돌려준 데이터를 성공 엔벌로프로 감싸고, 돌려준 것이 없으면 data를 null로 둔다', async () => {
    const interceptor = new EnvelopeInterceptor();
    await expect(firstValueFrom(interceptor.intercept(context, handlerReturning({ id: 'a' })))).resolves.toEqual({
      success: true,
      data: { id: 'a' },
      error: null,
    });
    await expect(firstValueFrom(interceptor.intercept(context, handlerReturning(undefined)))).resolves.toEqual({
      success: true,
      data: null,
      error: null,
    });
  });
});
