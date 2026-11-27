const MINUTE_MS = 60 * 1000;

/** 연속으로 틀리면 잠그는 횟수와 시간(ERD §5 규칙 22, 정의서 API-002 '실패 5회 시 계정 잠금') */
export const LOGIN_LOCK_THRESHOLD = 5;
export const LOGIN_LOCK_DURATION_MS = 30 * MINUTE_MS;

export const DUMMY_PASSWORD_BYTES = 16;

/** 발급하는 refresh는 32바이트를 base64url로 쓴 43자다. 그보다 훨씬 긴 값은 해시하지 않고 막는다 */
export const REFRESH_TOKEN_MAX_LENGTH = 128;

export const PASSWORD_MIN_LENGTH = 8;
/** ERD 규칙 20이 더한 상한 — 아주 긴 입력으로 해시 계산을 오래 붙잡지 못하게 */
export const PASSWORD_MAX_LENGTH = 64;
/** 영문·숫자·특수문자를 모두 담는다(REQ-GU-007). 특수문자는 영문 자판의 기호다 */
export const PASSWORD_RULES = {
  LETTER: /[A-Za-z]/,
  DIGIT: /\d/,
  SYMBOL: /[!-/:-@[-`{-~]/,
} as const;

export const NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;
/** 휴대폰 번호(숫자만) — 010·011·016~019로 시작하는 10~11자리 */
export const MOBILE_PHONE_PATTERN = /^01[016789]\d{7,8}$/;

/** web 가입 화면의 약관 4종(ERD §4.17) */
export const TermsType = {
  AGE14: 'AGE14',
  TERMS: 'TERMS',
  PRIVACY: 'PRIVACY',
  MARKETING: 'MARKETING',
} as const;
export type TermsType = (typeof TermsType)[keyof typeof TermsType];

/** 동의 경로(ERD §4.18). 카카오 가입은 S1-d에서 더한다 */
export const AgreementChannel = { EMAIL_SIGNUP: 'EMAIL_SIGNUP' } as const;
export type AgreementChannel = (typeof AgreementChannel)[keyof typeof AgreementChannel];
