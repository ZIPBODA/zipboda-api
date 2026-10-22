/**
 * API 정의서 '공통 오류코드 정의서'(ERR-001~016)와 1:1. 키는 정의서의 반환 메시지다.
 * 응답 error.code에는 반환 코드(E001…)를, error.message에는 이 키를 싣는다.
 */
export const ERROR_CODES = {
  BAD_REQUEST: { id: 'ERR-001', code: 'E001', status: 400 },
  AUTHENTICATION_FAILED: { id: 'ERR-002', code: 'E002', status: 401 },
  UNAUTHORIZED: { id: 'ERR-003', code: 'E004', status: 401 },
  CONFLICT: { id: 'ERR-004', code: 'E005', status: 409 },
  VALIDATION_ERROR: { id: 'ERR-005', code: 'E006', status: 422 },
  TOKEN_EXPIRED: { id: 'ERR-006', code: 'E007', status: 401 },
  EMPTY_RESULT: { id: 'ERR-007', code: 'E008', status: 200 },
  NOT_FOUND: { id: 'ERR-008', code: 'E009', status: 404 },
  NOT_AVAILABLE: { id: 'ERR-009', code: 'E010', status: 409 },
  UPSTREAM_ERROR: { id: 'ERR-010', code: 'E011', status: 502 },
  SOCIAL_AUTH_FAILED: { id: 'ERR-011', code: 'E012', status: 401 },
  TOO_MANY_REQUESTS: { id: 'ERR-012', code: 'E013', status: 429 },
  FORBIDDEN: { id: 'ERR-013', code: 'E014', status: 403 },
  OUT_OF_STOCK: { id: 'ERR-014', code: 'E015', status: 409 },
  PAYLOAD_TOO_LARGE: { id: 'ERR-015', code: 'E016', status: 413 },
  INTERNAL_SERVER_ERROR: { id: 'ERR-016', code: 'E999', status: 500 },
} as const satisfies Record<string, { id: string; code: string; status: number }>;

export type ErrorName = keyof typeof ERROR_CODES;
