import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsObject,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  MOBILE_PHONE_PATTERN,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  REFRESH_TOKEN_MAX_LENGTH,
} from '../constants.js';

const trimmed = ({ value }: TransformFnParams): unknown => {
  const raw: unknown = value;
  return typeof raw === 'string' ? raw.trim() : raw;
};

/** 이메일은 공백을 버리고 소문자로 저장·비교한다(ERD §5 규칙 20, DB CHECK) */
const normalizedEmail = ({ value }: TransformFnParams): unknown => {
  const raw: unknown = value;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
};

/** web 입력은 '010-1234-5678'처럼 올 수 있다 — 숫자만 남겨 저장한다 */
const phoneDigits = ({ value }: TransformFnParams): unknown => {
  const raw: unknown = value;
  return typeof raw === 'string' ? raw.replace(/[\s-]/g, '') : raw;
};

/** 필수 3종은 true여야 가입한다(ERD §5 규칙 26), 마케팅은 받은 값 그대로 남긴다 */
export class SignupAgreements {
  @Equals(true)
  age14: boolean;

  @Equals(true)
  terms: boolean;

  @Equals(true)
  privacy: boolean;

  @IsBoolean()
  marketing: boolean;
}

/** API-001 회원가입 */
export class SignupRequest {
  @Transform(trimmed)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name: string;

  @Transform(normalizedEmail)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_RULES.LETTER)
  @Matches(PASSWORD_RULES.DIGIT)
  @Matches(PASSWORD_RULES.SYMBOL)
  password: string;

  @Transform(phoneDigits)
  @IsString()
  @Matches(MOBILE_PHONE_PATTERN)
  phone: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SignupAgreements)
  agreements: SignupAgreements;
}

/** API-002 이메일 로그인. 비밀번호 규칙은 가입 때만 본다 — 로그인에서 규칙을 알려 주지 않게 */
export class LoginRequest {
  @Transform(normalizedEmail)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

/** API-005 토큰 재발급 */
export class TokenRefreshRequest {
  @IsString()
  @Length(1, REFRESH_TOKEN_MAX_LENGTH)
  refreshToken: string;
}
