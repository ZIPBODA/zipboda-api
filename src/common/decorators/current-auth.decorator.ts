import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppException } from '@/common/errors/app.exception.js';
import type { AuthenticatedRequest } from '@/common/guards/jwt-auth.guard.js';
import type { AccessTokenClaims } from '@/common/security/access-token.service.js';

/** JwtAuthGuard가 확인한 로그인 정보. 가드 없이 쓰면 로그인하지 않은 것으로 본다 */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AccessTokenClaims => {
  const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!auth) throw new AppException('UNAUTHORIZED');
  return auth;
});
