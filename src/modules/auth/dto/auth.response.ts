import type { UserRole } from '@/common/constants/interface-codes.js';

/** 로그인한 본인에게만 주는 회원 정보. 이름은 복호화한 원문이다 */
export interface AuthUserResponse {
  id: string;
  email: string | null;
  name: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}

/** API-001 */
export interface SignupResponse {
  userId: string;
  email: string;
}

/** API-005. 정의서는 accessToken만 주지만 refresh를 회전해 새 refreshToken도 준다(ERD §2.2 S1-7) */
export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
}

/** API-002 */
export interface LoginResponse extends TokenPairResponse {
  user: AuthUserResponse;
}

/** API-008 */
export interface MeResponse {
  user: AuthUserResponse;
  roles: UserRole[];
}
