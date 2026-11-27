const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const MS_PER_SECOND = SECOND_MS;

/** 로그인 토큰 정책(ERD §2.2 S1-7·§5 규칙 23). access는 짧게 두고 refresh로 이어 받는다 */
export const ACCESS_TOKEN_TTL_MS = 15 * MINUTE_MS;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY_MS;
/** 여러 탭이 같은 refresh로 동시에 재발급하는 틈. 이 안의 재사용은 탈취로 보지 않는다 */
export const REFRESH_REUSE_GRACE_MS = 30 * SECOND_MS;

/** access 토큰 형식 — 다른 알고리즘·발급자·대상으로 서명한 토큰은 받지 않는다 */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_ISSUER = 'zipboda-api';
export const ACCESS_TOKEN_AUDIENCE = 'zipboda';
