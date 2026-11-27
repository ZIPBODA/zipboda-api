import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { UserRole } from '@/common/constants/interface-codes.js';
import { Clock } from '@/common/time/clock.js';
import type { Env } from '@/config/env.schema.js';
import { AccessTokenService } from './access-token.service.js';

const SECRET = 'test-access-token-secret-0123456789abcdef';
const ISSUED_AT = new Date('2026-11-27T00:00:00Z');
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

class MovableClock extends Clock {
  constructor(public current: Date) {
    super();
  }

  now(): Date {
    return this.current;
  }
}

const serviceWith = (clock: Clock, secret = SECRET) =>
  new AccessTokenService(new ConfigService<Env, true>({ JWT_ACCESS_SECRET: secret }), clock);

const claims = { userId: 'user-1', roles: [UserRole.CITIZEN], sessionId: 'family-1' };

describe('access 토큰', () => {
  it('발급한 토큰을 검증하면 회원·역할·로그인 묶음을 돌려준다', async () => {
    const service = serviceWith(new MovableClock(ISSUED_AT));
    await expect(service.verify(await service.issue(claims))).resolves.toEqual(claims);
  });

  it('15분이 지나면 만료(ERR-006)다', async () => {
    const clock = new MovableClock(ISSUED_AT);
    const service = serviceWith(clock);
    const token = await service.issue(claims);

    clock.current = new Date(ISSUED_AT.getTime() + FIFTEEN_MINUTES_MS - 1000);
    await expect(service.verify(token)).resolves.toEqual(claims);
    clock.current = new Date(ISSUED_AT.getTime() + FIFTEEN_MINUTES_MS + 1000);
    await expect(service.verify(token)).rejects.toMatchObject({ errorName: 'TOKEN_EXPIRED' });
  });

  it('서명이 다르거나 바뀐 토큰은 인증 실패(ERR-003)다', async () => {
    const clock = new MovableClock(ISSUED_AT);
    const token = await serviceWith(clock).issue(claims);

    await expect(serviceWith(clock, `${SECRET}-other`).verify(token)).rejects.toMatchObject({
      errorName: 'UNAUTHORIZED',
    });
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin', roles: ['ADMIN'], sid: 'x' })).toString(
      'base64url',
    );
    await expect(serviceWith(clock).verify(`${header}.${forgedPayload}.${signature}`)).rejects.toMatchObject({
      errorName: 'UNAUTHORIZED',
    });
    await expect(serviceWith(clock).verify('not-a-token')).rejects.toMatchObject({ errorName: 'UNAUTHORIZED' });
  });

  describe('같은 키로 서명했어도 형식이 다르면 받지 않는다(ERR-003)', () => {
    const clock = new MovableClock(ISSUED_AT);
    const key = new TextEncoder().encode(SECRET);
    const validPayload = { roles: ['CITIZEN'], sid: 'family-1' };
    const signed = (
      payload: Record<string, unknown>,
      { alg = 'HS256', issuer = 'zipboda-api', audience = 'zipboda' } = {},
    ) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg })
        .setSubject('user-1')
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(Math.floor(ISSUED_AT.getTime() / 1000))
        .setExpirationTime(Math.floor((ISSUED_AT.getTime() + FIFTEEN_MINUTES_MS) / 1000))
        .sign(key);
    const rejects = async (token: Promise<string>) =>
      expect(serviceWith(clock).verify(await token)).rejects.toMatchObject({ errorName: 'UNAUTHORIZED' });

    it('기준 토큰은 통과한다(아래 실패가 다른 이유 때문이 아님을 보인다)', async () => {
      await expect(serviceWith(clock).verify(await signed(validPayload))).resolves.toMatchObject({
        userId: 'user-1',
      });
    });

    it('다른 알고리즘·발급자·대상', async () => {
      await rejects(signed(validPayload, { alg: 'HS512' }));
      await rejects(signed(validPayload, { issuer: 'someone-else' }));
      await rejects(signed(validPayload, { audience: 'other-app' }));
    });

    it('모르는 역할이나 로그인 묶음이 없는 토큰', async () => {
      await rejects(signed({ roles: ['GUEST'], sid: 'family-1' }));
      await rejects(signed({ roles: ['CITIZEN'] }));
    });
  });
});
