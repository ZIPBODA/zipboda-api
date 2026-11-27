import { Injectable } from '@nestjs/common';
import { UserRole } from '@/common/constants/interface-codes.js';
import type { Prisma } from '@/database/generated/client.js';
import { PrismaService } from '@/database/prisma.service.js';
import { LOGIN_LOCK_THRESHOLD, type AgreementChannel } from './constants.js';

const withRoles = { roles: { select: { role: true } } } as const satisfies Prisma.UserInclude;

export type UserWithRoles = Prisma.UserGetPayload<{ include: typeof withRoles }>;

const withOwner = { user: { include: withRoles } } as const satisfies Prisma.RefreshTokenInclude;

export type RefreshTokenWithOwner = Prisma.RefreshTokenGetPayload<{ include: typeof withOwner }>;

export interface NewMember {
  email: string;
  passwordHash: string;
  nameEnc: Uint8Array<ArrayBuffer>;
  phoneEnc: Uint8Array<ArrayBuffer>;
  phoneHash: string;
  agreements: { termsVersionId: string; agreed: boolean }[];
  channel: AgreementChannel;
}

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  createdIp: string | null;
}

/** DB의 날짜(date) 열은 UTC 자정으로 비교된다 */
const dateColumnOf = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { email }, include: withRoles });
  }

  findUserById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { id }, include: withRoles });
  }

  /** 종류마다 오늘(한국 날짜) 시행 중인 버전 — 시행일이 오늘 이전이거나 오늘인 것 가운데 가장 늦은 것(ERD §5 규칙 26) */
  findEffectiveTerms(today: string): Promise<{ id: string; type: string }[]> {
    return this.prisma.termsVersion.findMany({
      where: { effectiveAt: { lte: dateColumnOf(today) } },
      orderBy: [{ type: 'asc' }, { effectiveAt: 'desc' }],
      distinct: ['type'],
      select: { id: true, type: true },
    });
  }

  /** 회원·CITIZEN 역할·약관 동의를 한 번에 만든다. 같은 이메일이 있으면 UNIQUE 위반(P2002)으로 실패한다 */
  createMember(tx: Prisma.TransactionClient, member: NewMember): Promise<UserWithRoles> {
    return tx.user.create({
      data: {
        email: member.email,
        passwordHash: member.passwordHash,
        nameEnc: member.nameEnc,
        phoneEnc: member.phoneEnc,
        phoneHash: member.phoneHash,
        roles: { create: { role: UserRole.CITIZEN } },
        agreements: {
          create: member.agreements.map((agreement) => ({ ...agreement, channel: member.channel })),
        },
      },
      include: withRoles,
    });
  }

  /**
   * 비밀번호를 검사하기 전에 시도 한 번을 잡는다(ERD §5 규칙 22). 잠긴 회원이면 잡지 못해 null이다.
   * 읽고 나서 검사하면 동시에 보낸 요청이 모두 잠금 검사를 지나 몇 번이든 맞혀 볼 수 있어, 한 UPDATE로 원자적으로 센다.
   * 잠금이 풀린 뒤 첫 시도는 1부터 다시 세고, 다섯 번째를 잡을 때 잠근다 — 그 시도의 비밀번호가 맞으면 markLoggedIn이 푼다
   */
  async reserveLoginAttempt(userId: string, now: Date, lockUntil: Date): Promise<{ locksNow: boolean } | null> {
    const rows = await this.prisma.$queryRaw<{ locked_until: Date | null }[]>`
      UPDATE "users"
      SET "failed_login_count" = CASE WHEN "locked_until" IS NULL THEN "failed_login_count" + 1 ELSE 1 END,
          "locked_until" = CASE
            WHEN (CASE WHEN "locked_until" IS NULL THEN "failed_login_count" + 1 ELSE 1 END) >= ${LOGIN_LOCK_THRESHOLD}
            THEN ${lockUntil}::timestamptz
            ELSE NULL
          END,
          "updated_at" = ${now}::timestamptz
      WHERE "id" = ${userId} AND ("locked_until" IS NULL OR "locked_until" <= ${now}::timestamptz)
      RETURNING "locked_until"`;
    const [row] = rows;
    return row ? { locksNow: row.locked_until !== null } : null;
  }

  async markLoggedIn(userId: string, now: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
  }

  async createRefreshToken(token: NewRefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({ data: token });
  }

  findRefreshToken(tokenHash: string): Promise<RefreshTokenWithOwner | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: withOwner });
  }

  /** 아직 쓰지 않은 토큰에만 사용 시각을 찍는다. 0이면 다른 요청이 먼저 썼거나 폐기됐다 */
  async claimRefreshToken(id: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }

  findRefreshTokenState(id: string): Promise<{ usedAt: Date | null; revokedAt: Date | null } | null> {
    return this.prisma.refreshToken.findUnique({ where: { id }, select: { usedAt: true, revokedAt: true } });
  }

  /**
   * 묶음에 폐기된 토큰이 하나라도 있으면 묶음 전체를 쓸 수 없다. 폐기와 재발급이 엇갈려 폐기 뒤에 만든 새 토큰이
   * 폐기를 비껴가도(폐기 UPDATE는 그때 있던 행만 본다) 다음 재발급에서 막히게 한다
   */
  async isFamilyRevoked(familyId: string): Promise<boolean> {
    const revoked = await this.prisma.refreshToken.findFirst({
      where: { familyId, revokedAt: { not: null } },
      select: { id: true },
    });
    return revoked !== null;
  }

  async revokeFamily(userId: string, familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
