import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/time/clock.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { hashOpaqueToken, newOpaqueToken } from '../src/modules/auth/opaque-token.js';

const NOW = new Date('2026-11-27T03:00:00Z');
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

class MovableClock extends Clock {
  current = NOW;

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const PASSWORD = 'Zipboda!2026';

const signupBody = (overrides: Record<string, unknown> = {}) => ({
  name: '홍길동',
  email: 'Hong@Example.com',
  password: PASSWORD,
  phone: '010-1234-5678',
  agreements: { age14: true, terms: true, privacy: true, marketing: false },
  ...overrides,
});

const errorOf = (code: string, message: string) => ({ success: false, data: null, error: { code, message } });

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

/** expect.any는 any 형식이라 그대로 넣으면 형식 검사가 막는다 — 글자이기만 하면 되는 자리에 쓴다 */
const anyString = (): string => expect.any(String) as string;

describe('회원 인증 API (e2e)', () => {
  const clock = new MovableClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;

  // 동의 이력·감사 로그는 트리거가 DELETE를 막아 TRUNCATE로 비운다
  const clean = () => prisma.$executeRaw`TRUNCATE "users", "audit_logs" CASCADE`;

  const signup = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/api/auth/signup').send(body);
  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/api/auth/token/refresh').send({ refreshToken });
  const me = (accessToken: string) =>
    request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
  const logout = (accessToken: string) =>
    request(app.getHttpServer()).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`);

  const signedUpAndLoggedIn = async () => {
    await signup(signupBody()).expect(201);
    const response = await login('hong@example.com', PASSWORD).expect(200);
    const { accessToken, refreshToken } = dataOf<TokenPair>(response);
    return { accessToken, refreshToken };
  };

  const auditActions = async () =>
    (await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map((log) => log.action);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.current = NOW;
    await clean();
  });

  afterAll(async () => {
    await clean();
    await app.close();
  });

  describe('API-001 회원가입', () => {
    it('이메일은 소문자로, 이름·휴대폰은 암호문으로 두고 CITIZEN 역할과 약관 4종 동의를 남긴다', async () => {
      const response = await signup(signupBody()).expect(201);
      expect(response.body).toEqual({
        success: true,
        data: { userId: anyString(), email: 'hong@example.com' },
        error: null,
      });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'hong@example.com' },
        include: { roles: true, agreements: { include: { termsVersion: true } } },
      });
      expect(user.id).toBe(dataOf<{ userId: string }>(response).userId);
      expect(Buffer.from(user.nameEnc ?? []).toString('utf8')).not.toContain('홍길동');
      expect(Buffer.from(user.phoneEnc ?? []).toString('utf8')).not.toContain('01012345678');
      expect(user.phoneHash).toMatch(/^[0-9a-f]{64}$/);
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.phoneVerifiedAt).toBeNull();
      expect(user.roles.map(({ role }) => role)).toEqual(['CITIZEN']);
      expect(
        Object.fromEntries(user.agreements.map(({ termsVersion, agreed }) => [termsVersion.type, agreed])),
      ).toEqual({ AGE14: true, TERMS: true, PRIVACY: true, MARKETING: false });
      expect(new Set(user.agreements.map(({ channel }) => channel))).toEqual(new Set(['EMAIL_SIGNUP']));
      expect(await auditActions()).toEqual(['SIGNUP']);
    });

    it('대소문자만 다른 같은 이메일은 ERR-004', async () => {
      await signup(signupBody()).expect(201);
      const response = await signup(signupBody({ email: 'HONG@example.com' })).expect(409);
      expect(response.body).toEqual(errorOf('E005', 'CONFLICT'));
      expect(await prisma.user.count()).toBe(1);
    });

    it.each([
      ['필수 약관(개인정보) 거부', { agreements: { age14: true, terms: true, privacy: false, marketing: true } }],
      ['약관 동의 없음', { agreements: undefined }],
      ['8자 미만 비밀번호', { password: 'Zip!26' }],
      ['특수문자 없는 비밀번호', { password: 'Zipboda2026' }],
      ['숫자 없는 비밀번호', { password: 'Zipboda!!!!' }],
      ['64자 넘는 비밀번호', { password: `Zipboda!2026${'a'.repeat(60)}` }],
      ['휴대폰이 아닌 번호', { phone: '02-123-4567' }],
      ['이메일 형식이 아님', { email: 'hong.example.com' }],
      ['빈 이름', { name: '   ' }],
      ['정의하지 않은 필드', { nickname: '길동' }],
    ])('%s는 ERR-005이고 회원을 만들지 않는다', async (_case, overrides) => {
      const response = await signup(signupBody(overrides)).expect(422);
      expect(response.body).toEqual(errorOf('E006', 'VALIDATION_ERROR'));
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('API-002 로그인 · API-008 내 정보', () => {
    it('로그인하면 토큰과 회원 정보를 주고, access로 내 정보(역할 포함)를 읽는다', async () => {
      await signup(signupBody()).expect(201);
      const response = await login('HONG@example.com', PASSWORD).expect(200);
      const user = {
        id: anyString(),
        email: 'hong@example.com',
        name: '홍길동',
        nickname: null,
        avatarUrl: null,
      };
      expect(dataOf(response)).toEqual({ accessToken: anyString(), refreshToken: anyString(), user });

      const mine = await me(dataOf<TokenPair>(response).accessToken).expect(200);
      expect(dataOf(mine)).toEqual({ user, roles: ['CITIZEN'] });

      const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'hong@example.com' } });
      expect(stored.lastLoginAt).toEqual(NOW);
      expect(await auditActions()).toEqual(['SIGNUP', 'LOGIN']);
    });

    it('없는 이메일과 틀린 비밀번호는 같은 ERR-002이고, 없는 이메일은 회원 없이 IP만 남긴다', async () => {
      await signup(signupBody()).expect(201);
      const unknown = await login('nobody@example.com', PASSWORD).expect(401);
      const wrong = await login('hong@example.com', 'Wrong!2026').expect(401);
      expect(unknown.body).toEqual(errorOf('E002', 'AUTHENTICATION_FAILED'));
      expect(wrong.body).toEqual(unknown.body);

      const [unknownLog, wrongLog] = await prisma.auditLog.findMany({
        where: { action: 'LOGIN_FAILED' },
        orderBy: { id: 'asc' },
      });
      expect(unknownLog).toMatchObject({ actorUserId: null, targetId: null });
      expect(unknownLog?.ip).toEqual(anyString());
      expect(wrongLog?.actorUserId).toEqual(anyString());
    });

    it('다섯 번 틀리면 30분 잠그고, 그동안은 맞는 비밀번호도 ERR-012, 30분이 지나면 다시 로그인한다', async () => {
      await signup(signupBody()).expect(201);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login('hong@example.com', 'Wrong!2026').expect(401);
      }
      const locked = await login('hong@example.com', PASSWORD).expect(429);
      expect(locked.body).toEqual(errorOf('E013', 'TOO_MANY_REQUESTS'));
      expect(await auditActions()).toContain('LOGIN_LOCKED');

      clock.advance(30 * MINUTE_MS - SECOND_MS);
      await login('hong@example.com', PASSWORD).expect(429);
      clock.advance(2 * SECOND_MS);
      await login('hong@example.com', PASSWORD).expect(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'hong@example.com' } });
      expect(stored).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('로그인에 성공하면 틀린 횟수를 0으로 되돌린다', async () => {
      await signup(signupBody()).expect(201);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await login('hong@example.com', 'Wrong!2026').expect(401);
      }
      await login('hong@example.com', PASSWORD).expect(200);
      await login('hong@example.com', 'Wrong!2026').expect(401);
      await login('hong@example.com', PASSWORD).expect(200);
    });

    it('토큰이 없거나 잘못되면 ERR-003, 15분이 지난 access는 ERR-006', async () => {
      const { accessToken } = await signedUpAndLoggedIn();
      const missing = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
      expect(missing.body).toEqual(errorOf('E004', 'UNAUTHORIZED'));
      await me('not-a-token').expect(401);

      clock.advance(15 * MINUTE_MS + SECOND_MS);
      const expired = await me(accessToken).expect(401);
      expect(expired.body).toEqual(errorOf('E007', 'TOKEN_EXPIRED'));
    });
  });

  describe('API-005 토큰 재발급', () => {
    it('새 refresh와 access를 주고, 쓴 refresh는 30초 안에만 다시 받는다(여러 탭 동시 요청)', async () => {
      const { refreshToken } = await signedUpAndLoggedIn();
      const first = await refresh(refreshToken).expect(200);
      const pair = dataOf<TokenPair>(first);
      expect(pair).toEqual({ accessToken: anyString(), refreshToken: anyString() });
      expect(pair.refreshToken).not.toBe(refreshToken);
      await me(pair.accessToken).expect(200);

      clock.advance(10 * SECOND_MS);
      await refresh(refreshToken).expect(200);
    });

    it('30초가 지나 쓴 refresh가 다시 오면 탈취로 보고 그 로그인의 토큰을 모두 폐기한다', async () => {
      const { refreshToken } = await signedUpAndLoggedIn();
      const rotated = await refresh(refreshToken).expect(200);

      clock.advance(31 * SECOND_MS);
      const reused = await refresh(refreshToken).expect(401);
      expect(reused.body).toEqual(errorOf('E007', 'TOKEN_EXPIRED'));
      await refresh(dataOf<TokenPair>(rotated).refreshToken).expect(401);
      expect(await auditActions()).toContain('TOKEN_REUSE');
    });

    it('모르는 refresh와 30일이 지난 refresh는 ERR-006', async () => {
      const { refreshToken } = await signedUpAndLoggedIn();
      await refresh('unknown-token').expect(401);

      clock.advance(30 * DAY_MS + SECOND_MS);
      const expired = await refresh(refreshToken).expect(401);
      expect(expired.body).toEqual(errorOf('E007', 'TOKEN_EXPIRED'));
    });
  });

  describe('API-004 로그아웃', () => {
    it('로그아웃한 로그인의 refresh만 못 쓰고, 다른 기기의 로그인은 그대로다', async () => {
      const phone = await signedUpAndLoggedIn();
      const laptop = dataOf<TokenPair>(await login('hong@example.com', PASSWORD).expect(200));

      const response = await logout(phone.accessToken).expect(200);
      expect(response.body).toEqual({ success: true, data: null, error: null });
      await refresh(phone.refreshToken).expect(401);
      await refresh(laptop.refreshToken).expect(200);
      expect(await auditActions()).toContain('LOGOUT');
    });

    it('토큰 없이 로그아웃하면 ERR-003', async () => {
      const response = await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
      expect(response.body).toEqual(errorOf('E004', 'UNAUTHORIZED'));
    });

    it('폐기된 로그인 묶음의 토큰은 폐기를 비껴간 것이어도 쓸 수 없다', async () => {
      const { accessToken, refreshToken } = await signedUpAndLoggedIn();
      const stored = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashOpaqueToken(refreshToken) },
      });
      await logout(accessToken).expect(200);

      // 재발급과 로그아웃이 엇갈려 폐기 뒤에 만들어진 토큰 — 폐기 UPDATE가 보지 못한 행이다
      const escaped = newOpaqueToken();
      await prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: escaped.tokenHash,
          expiresAt: new Date(NOW.getTime() + DAY_MS),
        },
      });
      await refresh(escaped.token).expect(401);
    });
  });

  describe('동시 요청', () => {
    it('틀린 비밀번호를 한꺼번에 보내도 다섯 번까지만 검사하고 나머지는 잠금(ERR-012)이다', async () => {
      await signup(signupBody()).expect(201);
      const responses = await Promise.all(Array.from({ length: 8 }, () => login('hong@example.com', 'Wrong!2026')));
      const statuses = responses.map(({ status }) => status).sort();
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
      await login('hong@example.com', PASSWORD).expect(429);
    });

    it('같은 refresh로 한꺼번에 재발급해도 모두 새 토큰을 받고 탈취로 보지 않는다(여러 탭)', async () => {
      const { refreshToken } = await signedUpAndLoggedIn();
      const responses = await Promise.all([refresh(refreshToken), refresh(refreshToken), refresh(refreshToken)]);
      expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
      expect(await auditActions()).not.toContain('TOKEN_REUSE');
    });
  });

  describe('그 밖의 회원', () => {
    it('카카오로만 가입한 회원(비밀번호 없음)은 이메일 로그인이 ERR-002다', async () => {
      const kakaoOnly = await prisma.user.create({ data: { email: 'kakao@example.com' } });
      const response = await login('kakao@example.com', PASSWORD).expect(401);
      expect(response.body).toEqual(errorOf('E002', 'AUTHENTICATION_FAILED'));
      const [log] = await prisma.auditLog.findMany({ where: { action: 'LOGIN_FAILED' } });
      expect(log?.actorUserId).toBe(kakaoOnly.id);
    });
  });

  describe('약관 버전', () => {
    // 테스트가 더한 약관 버전은 동의(회원)를 먼저 비운 뒤 지운다 — 동의가 버전을 RESTRICT로 가리킨다
    const removeTestTerms = async () => {
      await clean();
      await prisma.termsVersion.deleteMany({ where: { version: { startsWith: 'e2e-' } } });
    };

    afterEach(removeTestTerms);

    it('동의는 한국 날짜로 시행 중인 버전 가운데 가장 늦은 버전에 남기고, 미래 버전은 시행일부터 쓴다', async () => {
      await prisma.termsVersion.createMany({
        data: [
          { type: 'TERMS', version: 'e2e-v2', required: true, effectiveAt: new Date('2026-11-01T00:00:00Z') },
          { type: 'TERMS', version: 'e2e-v3', required: true, effectiveAt: new Date('2026-11-28T00:00:00Z') },
        ],
      });
      const termsVersionOf = async (email: string) => {
        const agreement = await prisma.userAgreement.findFirstOrThrow({
          where: { user: { email }, termsVersion: { type: 'TERMS' } },
          include: { termsVersion: true },
        });
        return agreement.termsVersion.version;
      };

      // UTC 11월 27일 03:00 = 한국 11월 27일 12:00
      await signup(signupBody({ email: 'today@example.com' })).expect(201);
      expect(await termsVersionOf('today@example.com')).toBe('e2e-v2');

      // UTC 11월 27일 15:30 = 한국 11월 28일 00:30 — UTC로는 아직 27일이어도 한국 날짜로 새 버전을 쓴다
      clock.current = new Date('2026-11-27T15:30:00Z');
      await signup(signupBody({ email: 'tomorrow@example.com' })).expect(201);
      expect(await termsVersionOf('tomorrow@example.com')).toBe('e2e-v3');
    });
  });
});
