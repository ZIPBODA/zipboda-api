import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';

/** S1 회원·인증 테이블의 DB 규칙(ERD §4.12~4.19). 앱이 어겨도 DB가 막는지 본다 */
describe('S1 회원·인증 스키마 (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  // 동의 이력·감사 로그는 트리거가 DELETE를 막아 TRUNCATE로 비운다(행 트리거는 TRUNCATE에 걸리지 않는다)
  const clean = () => prisma.$executeRaw`TRUNCATE "users", "audit_logs" CASCADE`;

  const termsOf = (type: string) => prisma.termsVersion.findFirstOrThrow({ where: { type, version: 'v1' } });
  const expiresAt = new Date('2026-12-27T00:00:00Z');

  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('첫 약관 버전은 web 가입 화면의 4종이고, 본문이 있는 것은 이용약관(/terms, 페이지 시행일)뿐이다', async () => {
    const terms = await prisma.termsVersion.findMany({ orderBy: { type: 'asc' } });
    expect(
      terms.map(({ type, version, required, effectiveAt, contentPath }) => ({
        type,
        version,
        required,
        effectiveAt: effectiveAt.toISOString().slice(0, 10),
        contentPath,
      })),
    ).toEqual([
      { type: 'AGE14', version: 'v1', required: true, effectiveAt: '2026-11-27', contentPath: null },
      { type: 'MARKETING', version: 'v1', required: false, effectiveAt: '2026-11-27', contentPath: null },
      { type: 'PRIVACY', version: 'v1', required: true, effectiveAt: '2026-11-27', contentPath: null },
      { type: 'TERMS', version: 'v1', required: true, effectiveAt: '2026-09-20', contentPath: '/terms' },
    ]);
  });

  it('약관은 정해진 종류만 받고, 종류마다 버전 이름과 시행일이 겹치지 않는다', async () => {
    const terms = await termsOf('TERMS');
    const otherDay = new Date('2027-01-01T00:00:00Z');

    await expect(
      prisma.termsVersion.create({ data: { type: 'COOKIE', version: 'v1', required: false, effectiveAt: otherDay } }),
    ).rejects.toThrow(/terms_versions_type_check/);
    await expect(
      prisma.termsVersion.create({ data: { type: 'TERMS', version: 'v1', required: true, effectiveAt: otherDay } }),
    ).rejects.toThrow(/version/);
    // 같은 날 시행하는 버전이 둘이면 어느 버전에 동의를 남길지 정할 수 없다(ERD §5 규칙 26)
    await expect(
      prisma.termsVersion.create({
        data: { type: 'TERMS', version: 'v2', required: true, effectiveAt: terms.effectiveAt },
      }),
    ).rejects.toThrow(/effective_at/);
    expect(await prisma.termsVersion.count()).toBe(4);
  });

  it('이메일은 소문자로만 받고, 같은 이메일은 하나만, 이메일 없는 회원은 여럿 받는다', async () => {
    await expect(prisma.user.create({ data: { email: 'User@Example.com' } })).rejects.toThrow(
      /users_email_lowercase_check/,
    );

    await prisma.user.create({ data: { email: 'user@example.com' } });
    await expect(prisma.user.create({ data: { email: 'user@example.com' } })).rejects.toThrow(/email/);

    await prisma.user.create({ data: {} });
    await prisma.user.create({ data: {} });
    expect(await prisma.user.count({ where: { email: null } })).toBe(2);
  });

  it('비밀번호가 있으면 로그인할 이메일이 있어야 한다', async () => {
    await expect(prisma.user.create({ data: { passwordHash: 'hash' } })).rejects.toThrow(
      /users_password_needs_email_check/,
    );
    await expect(prisma.user.create({ data: { email: 'a@b.c', passwordHash: 'hash' } })).resolves.toBeDefined();
  });

  it('휴대폰 암호문과 찾기용 HMAC은 함께 있거나 함께 없다', async () => {
    await expect(prisma.user.create({ data: { phoneEnc: Buffer.from('enc') } })).rejects.toThrow(
      /users_phone_pair_check/,
    );
    await expect(prisma.user.create({ data: { phoneHash: 'hash' } })).rejects.toThrow(/users_phone_pair_check/);
    await expect(
      prisma.user.create({ data: { phoneEnc: Buffer.from('enc'), phoneHash: 'hash' } }),
    ).resolves.toBeDefined();
  });

  it('관심 분야는 기본이 빈 배열이고 NULL은 받지 않는다', async () => {
    const user = await prisma.user.create({ data: {} });
    expect(user.interests).toEqual([]);

    // NOT NULL은 Prisma 스키마로 쓰지 못해 마이그레이션에만 있다 — 클라이언트를 거치지 않고 넣어 본다
    await expect(
      prisma.$executeRaw`INSERT INTO "users" ("id", "interests", "updated_at") VALUES ('null-interests', NULL, now())`,
    ).rejects.toThrow(/interests/);
  });

  it('역할·소셜 제공자·동의 경로는 정해진 값을 모두 받고 그 밖의 값은 막는다', async () => {
    const user = await prisma.user.create({ data: { email: 'a@b.c' } });
    const terms = await termsOf('TERMS');

    await expect(prisma.userRole.create({ data: { userId: user.id, role: 'GUEST' } })).rejects.toThrow(
      /user_roles_role_check/,
    );
    for (const role of ['CITIZEN', 'OPERATOR', 'ADMIN']) {
      await expect(prisma.userRole.create({ data: { userId: user.id, role } })).resolves.toBeDefined();
    }

    await expect(
      prisma.socialAccount.create({ data: { userId: user.id, provider: 'apple', providerUserId: '1' } }),
    ).rejects.toThrow(/social_accounts_provider_check/);
    for (const provider of ['kakao', 'naver', 'google']) {
      await expect(
        prisma.socialAccount.create({ data: { userId: user.id, provider, providerUserId: '1' } }),
      ).resolves.toBeDefined();
    }

    await expect(
      prisma.userAgreement.create({
        data: { userId: user.id, termsVersionId: terms.id, agreed: true, channel: 'WEB' },
      }),
    ).rejects.toThrow(/user_agreements_channel_check/);
    for (const channel of ['EMAIL_SIGNUP', 'KAKAO_SIGNUP']) {
      await expect(
        prisma.userAgreement.create({ data: { userId: user.id, termsVersionId: terms.id, agreed: true, channel } }),
      ).resolves.toBeDefined();
    }
  });

  it('카카오 회원번호 하나는 한 회원에만, 한 회원은 제공자마다 계정 하나만 잇는다', async () => {
    const [first, second] = await Promise.all([
      prisma.user.create({ data: { email: 'first@b.c' } }),
      prisma.user.create({ data: { email: 'second@b.c' } }),
    ]);
    await prisma.socialAccount.create({ data: { userId: first.id, provider: 'kakao', providerUserId: '100' } });

    await expect(
      prisma.socialAccount.create({ data: { userId: second.id, provider: 'kakao', providerUserId: '100' } }),
    ).rejects.toThrow(/provider/);
    await expect(
      prisma.socialAccount.create({ data: { userId: first.id, provider: 'kakao', providerUserId: '200' } }),
    ).rejects.toThrow(/provider/);
  });

  it('refresh·재설정 토큰은 같은 해시를 두 번 받지 않는다', async () => {
    const user = await prisma.user.create({ data: { email: 'a@b.c' } });
    const familyId = '00000000-0000-4000-8000-000000000001';
    await prisma.refreshToken.create({ data: { userId: user.id, familyId, tokenHash: 'same', expiresAt } });
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: 'same', expiresAt } });

    await expect(
      prisma.refreshToken.create({ data: { userId: user.id, familyId, tokenHash: 'same', expiresAt } }),
    ).rejects.toThrow(/token_hash/);
    await expect(
      prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: 'same', expiresAt } }),
    ).rejects.toThrow(/token_hash/);
  });

  it('동의 이력과 감사 로그는 더하기만 하고 고치거나 지울 수 없다', async () => {
    const user = await prisma.user.create({ data: { email: 'a@b.c' } });
    const terms = await termsOf('MARKETING');
    const agreement = await prisma.userAgreement.create({
      data: { userId: user.id, termsVersionId: terms.id, agreed: true, channel: 'EMAIL_SIGNUP' },
    });
    const log = await prisma.auditLog.create({ data: { actorUserId: user.id, action: 'SIGNUP', ip: '127.0.0.1' } });

    await expect(prisma.userAgreement.update({ where: { id: agreement.id }, data: { agreed: false } })).rejects.toThrow(
      /기록을 더하기만/,
    );
    await expect(prisma.userAgreement.delete({ where: { id: agreement.id } })).rejects.toThrow(/기록을 더하기만/);
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'LOGIN' } })).rejects.toThrow(
      /기록을 더하기만/,
    );
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/기록을 더하기만/);

    // 마케팅 수신 철회는 행을 더해 남긴다
    await prisma.userAgreement.create({
      data: { userId: user.id, termsVersionId: terms.id, agreed: false, channel: 'EMAIL_SIGNUP' },
    });
    expect(await prisma.userAgreement.count({ where: { userId: user.id } })).toBe(2);
  });

  it('동의 이력이 있는 회원은 지울 수 없고, 토큰만 남긴 회원은 토큰과 함께 지워진다', async () => {
    const agreed = await prisma.user.create({ data: { email: 'agreed@b.c' } });
    const terms = await termsOf('TERMS');
    await prisma.userAgreement.create({
      data: { userId: agreed.id, termsVersionId: terms.id, agreed: true, channel: 'EMAIL_SIGNUP' },
    });
    await expect(prisma.user.delete({ where: { id: agreed.id } })).rejects.toThrow(/Foreign key constraint/);

    const tokensOnly = await prisma.user.create({ data: { email: 'tokens@b.c' } });
    await prisma.refreshToken.create({
      data: {
        userId: tokensOnly.id,
        familyId: '00000000-0000-4000-8000-000000000002',
        tokenHash: 'refresh',
        expiresAt,
      },
    });
    await prisma.passwordResetToken.create({ data: { userId: tokensOnly.id, tokenHash: 'reset', expiresAt } });

    await prisma.user.delete({ where: { id: tokensOnly.id } });
    expect(await prisma.refreshToken.count()).toBe(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('평면도 생성·수정 시각은 시간대를 가진다', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'floorplans' AND column_name IN ('created_at', 'updated_at') ORDER BY column_name`;
    expect(columns).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone' },
    ]);
  });
});
