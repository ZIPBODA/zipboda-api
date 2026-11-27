import { createHash, randomBytes } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;

/** refresh 토큰처럼 서버만 뜻을 아는 무작위 토큰. DB에는 해시만 둔다 — DB가 새도 토큰을 쓸 수 없게 */
export const hashOpaqueToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export const newOpaqueToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashOpaqueToken(token) };
};
