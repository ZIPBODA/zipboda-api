import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.schema.js';

const AUTH_KEYS = {
  JWT_ACCESS_SECRET: 'test-access-token-secret-0123456789abcdef',
  PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PII_HASH_KEY: randomBytes(32).toString('base64'),
};

const REQUIRED = { DATABASE_URL: 'postgresql://local/db', ...AUTH_KEYS };

describe('환경 변수 검사', () => {
  it('기본값을 채우고 허용 출처를 목록으로 나눈다', () => {
    const env = validateEnv({ ...REQUIRED, CORS_ORIGINS: 'http://a.test, http://b.test,' });
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: 'postgresql://local/db',
      CORS_ORIGINS: ['http://a.test', 'http://b.test'],
      ...AUTH_KEYS,
    });
  });

  it('DB 주소가 없거나 포트가 숫자가 아니면 기동을 멈춘다', () => {
    expect(() => validateEnv({ ...AUTH_KEYS })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('인증 키가 없거나 짧거나 base64가 아니면 기동을 멈춘다', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://local/db' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...REQUIRED, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...REQUIRED, PII_ENCRYPTION_KEY: randomBytes(16).toString('base64') })).toThrow(
      /PII_ENCRYPTION_KEY/,
    );
    expect(() => validateEnv({ ...REQUIRED, PII_ENCRYPTION_KEY: '이건-base64가-아니다' })).toThrow(
      /PII_ENCRYPTION_KEY/,
    );
    expect(() => validateEnv({ ...REQUIRED, PII_HASH_KEY: randomBytes(16).toString('base64') })).toThrow(
      /PII_HASH_KEY/,
    );
    expect(() => validateEnv({ ...REQUIRED, PII_HASH_KEY: REQUIRED.PII_ENCRYPTION_KEY })).toThrow(/PII_HASH_KEY/);
  });
});
