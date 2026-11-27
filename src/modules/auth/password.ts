import { hash, verify } from '@node-rs/argon2';

/** argon2id(라이브러리 기본 알고리즘·비용). 원문은 어디에도 남기지 않는다(ERD §5 규칙 20) */
export const hashPassword = (password: string): Promise<string> => hash(password);

export const verifyPassword = (passwordHash: string, password: string): Promise<boolean> =>
  verify(passwordHash, password);
