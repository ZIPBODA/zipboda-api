import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { UserRole } from '@/common/constants/interface-codes.js';
import { Roles } from '@/common/decorators/roles.decorator.js';
import { AppException } from '@/common/errors/app.exception.js';
import type { AccessTokenClaims } from '@/common/security/access-token.service.js';
import { RolesGuard } from './roles.guard.js';

class Endpoints {
  open(this: void): void {}

  @Roles([UserRole.OPERATOR, UserRole.ADMIN])
  staffOnly(this: void): void {}
}

const guard = new RolesGuard(new Reflector());
const passes = (handler: () => void, auth?: AccessTokenClaims): boolean =>
  guard.canActivate(new ExecutionContextHost([{ auth }], Endpoints, handler));

const errorNameOf = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppException ? error.errorName : 'UNEXPECTED';
  }
};

const claimsWith = (roles: UserRole[]): AccessTokenClaims => ({ userId: 'u', roles, sessionId: 's' });
const { open, staffOnly } = Endpoints.prototype;

describe('역할 검사', () => {
  it('역할을 정하지 않은 API는 누구나 지난다', () => {
    expect(passes(open, claimsWith([UserRole.CITIZEN]))).toBe(true);
  });

  it('정한 역할 가운데 하나라도 있으면 지난다', () => {
    expect(passes(staffOnly, claimsWith([UserRole.CITIZEN, UserRole.OPERATOR]))).toBe(true);
  });

  it('로그인했지만 역할이 없으면 ERR-013, 로그인하지 않았으면 ERR-003', () => {
    expect(errorNameOf(() => passes(staffOnly, claimsWith([UserRole.CITIZEN])))).toBe('FORBIDDEN');
    expect(errorNameOf(() => passes(staffOnly))).toBe('UNAUTHORIZED');
  });
});
