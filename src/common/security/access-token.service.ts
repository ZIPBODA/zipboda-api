import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_MS,
  MS_PER_SECOND,
} from '@/common/constants/auth-tokens.js';
import { isUserRole, type UserRole } from '@/common/constants/interface-codes.js';
import { AppException } from '@/common/errors/app.exception.js';
import { Clock } from '@/common/time/clock.js';
import type { Env } from '@/config/env.schema.js';

/** access 토큰이 담는 것. sessionId는 refresh 토큰 묶음(family) — 본문 없는 로그아웃이 이 묶음을 폐기한다(ERD §5 규칙 23) */
export interface AccessTokenClaims {
  userId: string;
  roles: UserRole[];
  sessionId: string;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const claimsOf = (payload: JWTPayload): AccessTokenClaims | null => {
  const { sub, roles, sid } = payload;
  if (typeof sub !== 'string' || typeof sid !== 'string' || !isStringArray(roles)) return null;
  if (!roles.every(isUserRole)) return null;
  return { userId: sub, roles, sessionId: sid };
};

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(
    config: ConfigService<Env, true>,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  issue(claims: AccessTokenClaims): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / MS_PER_SECOND);
    return new SignJWT({ roles: claims.roles, sid: claims.sessionId })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM })
      .setSubject(claims.userId)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_MS / MS_PER_SECOND)
      .sign(this.key);
  }

  /** 만료는 ERR-006(재발급하면 된다), 그 밖의 잘못된 토큰은 ERR-003으로 가른다 */
  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        currentDate: this.clock.now(),
      });
      const claims = claimsOf(payload);
      if (!claims) throw new AppException('UNAUTHORIZED');
      return claims;
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (error instanceof errors.JWTExpired) throw new AppException('TOKEN_EXPIRED');
      throw new AppException('UNAUTHORIZED');
    }
  }
}
