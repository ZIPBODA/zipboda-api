import type { AuthUserResponse } from '../dto/auth.response.js';

interface UserFields {
  id: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}

/** 이름은 암호문이라 복호화한 값을 따로 받는다 — 암호화 키를 매퍼가 알지 않게 */
export const toAuthUserResponse = (user: UserFields, name: string | null): AuthUserResponse => ({
  id: user.id,
  email: user.email,
  name,
  nickname: user.nickname,
  avatarUrl: user.avatarUrl,
});
