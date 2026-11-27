import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { REFRESH_REUSE_GRACE_MS, REFRESH_TOKEN_TTL_MS } from '@/common/constants/auth-tokens.js';
import { PRISMA_UNIQUE_VIOLATION } from '@/common/constants/database.js';
import { highestRoleOf, isUserRole, UserRole } from '@/common/constants/interface-codes.js';
import type { ClientMeta } from '@/common/decorators/client-meta.decorator.js';
import { AppException } from '@/common/errors/app.exception.js';
import { AccessTokenService, type AccessTokenClaims } from '@/common/security/access-token.service.js';
import { PiiCipher } from '@/common/security/pii-cipher.js';
import { Clock } from '@/common/time/clock.js';
import { serviceDateOf } from '@/common/time/service-date.js';
import { Prisma } from '@/database/generated/client.js';
import { PrismaService } from '@/database/prisma.service.js';
import { AuditLogService } from '@/modules/audit/audit-log.service.js';
import { AuditAction, AuditTarget } from '@/modules/audit/constants.js';
import { AuthRepository, type RefreshTokenWithOwner, type UserWithRoles } from './auth.repository.js';
import { AgreementChannel, DUMMY_PASSWORD_BYTES, LOGIN_LOCK_DURATION_MS, TermsType } from './constants.js';
import type { LoginRequest, SignupAgreements, SignupRequest, TokenRefreshRequest } from './dto/auth.request.js';
import type {
  AuthUserResponse,
  LoginResponse,
  MeResponse,
  SignupResponse,
  TokenPairResponse,
} from './dto/auth.response.js';
import { toAuthUserResponse } from './mappers/auth-user.mapper.js';
import { hashOpaqueToken, newOpaqueToken } from './opaque-token.js';
import { hashPassword, verifyPassword } from './password.js';

const rolesOf = (user: UserWithRoles): UserRole[] => user.roles.map(({ role }) => role).filter(isUserRole);

const agreedOf = (agreements: SignupAgreements, type: TermsType): boolean => {
  switch (type) {
    case TermsType.AGE14:
      return agreements.age14;
    case TermsType.TERMS:
      return agreements.terms;
    case TermsType.PRIVACY:
      return agreements.privacy;
    case TermsType.MARKETING:
      return agreements.marketing;
  }
};

const isTermsType = (value: string): value is TermsType => Object.hasOwn(TermsType, value);

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_VIOLATION;

@Injectable()
export class AuthService {
  /** 없는 이메일에도 같은 시간만큼 해시를 검사해, 응답 시간으로 가입 여부를 알아내지 못하게 한다 */
  private readonly dummyPasswordHash = hashPassword(randomBytes(DUMMY_PASSWORD_BYTES).toString('hex'));

  constructor(
    private readonly repository: AuthRepository,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly cipher: PiiCipher,
    private readonly accessTokens: AccessTokenService,
    private readonly clock: Clock,
  ) {}

  /** API-001. 동의는 종류마다 오늘 시행 중인 약관 버전에 남긴다(ERD §5 규칙 26) */
  async signup(request: SignupRequest, client: ClientMeta): Promise<SignupResponse> {
    const agreements = await this.agreementsFor(request.agreements);
    const passwordHash = await hashPassword(request.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await this.repository.createMember(tx, {
          email: request.email,
          passwordHash,
          nameEnc: this.cipher.encrypt(request.name),
          phoneEnc: this.cipher.encrypt(request.phone),
          phoneHash: this.cipher.hash(request.phone),
          agreements,
          channel: AgreementChannel.EMAIL_SIGNUP,
        });
        await this.audit.record(
          {
            action: AuditAction.SIGNUP,
            actorUserId: created.id,
            actorRole: UserRole.CITIZEN,
            target: { type: AuditTarget.USER, id: created.id },
            client,
          },
          tx,
        );
        return created;
      });
      return { userId: user.id, email: request.email };
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('CONFLICT');
      throw error;
    }
  }

  /**
   * API-002. 없는 이메일·비밀번호 없는 회원(카카오 전용)·틀린 비밀번호는 모두 ERR-002로 같게 답한다.
   * 잠긴 동안은 비밀번호가 맞아도 ERR-012(ERD §5 규칙 22)
   */
  async login(request: LoginRequest, client: ClientMeta): Promise<LoginResponse> {
    const now = this.clock.now();
    const user = await this.repository.findUserByEmail(request.email);
    if (!user?.passwordHash) {
      await verifyPassword(await this.dummyPasswordHash, request.password);
      await this.recordForUser(AuditAction.LOGIN_FAILED, user, client);
      throw new AppException('AUTHENTICATION_FAILED');
    }
    const attempt = await this.repository.reserveLoginAttempt(
      user.id,
      now,
      new Date(now.getTime() + LOGIN_LOCK_DURATION_MS),
    );
    if (!attempt) {
      await this.recordForUser(AuditAction.LOGIN_FAILED, user, client);
      throw new AppException('TOO_MANY_REQUESTS');
    }
    if (!(await verifyPassword(user.passwordHash, request.password))) {
      await this.recordForUser(AuditAction.LOGIN_FAILED, user, client);
      if (attempt.locksNow) await this.recordForUser(AuditAction.LOGIN_LOCKED, user, client);
      throw new AppException('AUTHENTICATION_FAILED');
    }

    await this.repository.markLoggedIn(user.id, now);
    const tokens = await this.issueTokens(user.id, rolesOf(user), randomUUID(), now, client);
    await this.recordForUser(AuditAction.LOGIN, user, client);
    return { ...tokens, user: this.userResponseOf(user) };
  }

  /**
   * API-005. 쓴 토큰에 사용 시각을 찍고 같은 묶음으로 새 토큰을 준다(회전).
   * 이미 쓴 토큰이 30초 안에 다시 오면 여러 탭의 동시 요청으로 보고, 그보다 늦거나 폐기된 토큰이면 묶음을 모두 폐기한다(ERD §5 규칙 23)
   */
  async refresh(request: TokenRefreshRequest, client: ClientMeta): Promise<TokenPairResponse> {
    const now = this.clock.now();
    const stored = await this.repository.findRefreshToken(hashOpaqueToken(request.refreshToken));
    if (!stored) throw new AppException('TOKEN_EXPIRED');
    if (stored.revokedAt || (await this.repository.isFamilyRevoked(stored.familyId))) {
      return this.rejectReuse(stored, now, client);
    }
    if (stored.expiresAt <= now) throw new AppException('TOKEN_EXPIRED');

    const isFirstUse = stored.usedAt === null && (await this.repository.claimRefreshToken(stored.id, now));
    if (!isFirstUse) {
      // 찍기에 실패했다면 다른 요청이 그사이 썼거나 폐기했다 — 지금 상태로 다시 판단한다
      const state = stored.usedAt ? stored : await this.repository.findRefreshTokenState(stored.id);
      const usedAt = state?.usedAt ?? null;
      const isConcurrentUse =
        usedAt !== null && !state?.revokedAt && now.getTime() - usedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      if (!isConcurrentUse) return this.rejectReuse(stored, now, client);
    }
    return this.issueTokens(stored.userId, rolesOf(stored.user), stored.familyId, now, client);
  }

  /** API-004. 본문 없이 access의 로그인 묶음을 폐기한다 — 이미 낸 access는 만료(15분)까지 남는다 */
  async logout(auth: AccessTokenClaims, client: ClientMeta): Promise<null> {
    await this.repository.revokeFamily(auth.userId, auth.sessionId, this.clock.now());
    await this.audit.record({
      action: AuditAction.LOGOUT,
      actorUserId: auth.userId,
      actorRole: highestRoleOf(auth.roles),
      target: { type: AuditTarget.USER, id: auth.userId },
      client,
    });
    return null;
  }

  /** API-008. 역할은 토큰이 아니라 DB에서 읽는다 — 역할이 바뀐 뒤에도 지금 역할을 보이게 */
  async me(auth: AccessTokenClaims): Promise<MeResponse> {
    const user = await this.repository.findUserById(auth.userId);
    if (!user) throw new AppException('UNAUTHORIZED');
    return { user: this.userResponseOf(user), roles: rolesOf(user) };
  }

  private async agreementsFor(agreements: SignupAgreements): Promise<{ termsVersionId: string; agreed: boolean }[]> {
    const terms = await this.repository.findEffectiveTerms(serviceDateOf(this.clock.now()));
    const missing = Object.values(TermsType).filter((type) => !terms.some((version) => version.type === type));
    // 마이그레이션이 첫 버전을 넣으므로, 빠졌다면 약관 데이터를 잘못 고친 것이다
    if (missing.length > 0) throw new Error(`시행 중인 약관 버전이 없습니다: ${missing.join(', ')}`);
    return terms.flatMap((version) =>
      isTermsType(version.type) ? [{ termsVersionId: version.id, agreed: agreedOf(agreements, version.type) }] : [],
    );
  }

  private async rejectReuse(stored: RefreshTokenWithOwner, now: Date, client: ClientMeta): Promise<never> {
    await this.repository.revokeFamily(stored.userId, stored.familyId, now);
    await this.recordForUser(AuditAction.TOKEN_REUSE, stored.user, client);
    throw new AppException('TOKEN_EXPIRED');
  }

  private async issueTokens(
    userId: string,
    roles: UserRole[],
    familyId: string,
    now: Date,
    client: ClientMeta,
  ): Promise<TokenPairResponse> {
    const refresh = newOpaqueToken();
    await this.repository.createRefreshToken({
      userId,
      familyId,
      tokenHash: refresh.tokenHash,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      userAgent: client.userAgent,
      createdIp: client.ip,
    });
    const accessToken = await this.accessTokens.issue({ userId, roles, sessionId: familyId });
    return { accessToken, refreshToken: refresh.token };
  }

  private async recordForUser(action: AuditAction, user: UserWithRoles | null, client: ClientMeta): Promise<void> {
    await this.audit.record({
      action,
      actorUserId: user?.id ?? null,
      actorRole: user ? highestRoleOf(rolesOf(user)) : null,
      target: user ? { type: AuditTarget.USER, id: user.id } : undefined,
      client,
    });
  }

  private userResponseOf(user: UserWithRoles): AuthUserResponse {
    return toAuthUserResponse(user, user.nameEnc ? this.cipher.decrypt(user.nameEnc) : null);
  }
}
