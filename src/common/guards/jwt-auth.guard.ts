import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '@/common/errors/app.exception.js';
import { AccessTokenService, type AccessTokenClaims } from '@/common/security/access-token.service.js';

export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenClaims;
}

const BEARER_PREFIX = 'Bearer ';

/** 로그인이 필요한 API에 건다. 토큰이 없거나 잘못되면 ERR-003, 만료면 ERR-006 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.get('authorization');
    if (!header?.startsWith(BEARER_PREFIX)) throw new AppException('UNAUTHORIZED');
    request.auth = await this.accessTokens.verify(header.slice(BEARER_PREFIX.length).trim());
    return true;
  }
}
