/** 감사 로그 행동(ERD §4.19). 관리자 행동은 관리자 인증 PR에서 더한다 */
export const AuditAction = {
  SIGNUP: 'SIGNUP',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGOUT: 'LOGOUT',
  TOKEN_REUSE: 'TOKEN_REUSE',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditTarget = { USER: 'user' } as const;
export type AuditTarget = (typeof AuditTarget)[keyof typeof AuditTarget];
