import { validateEnv } from './env.schema.js';

describe('환경 변수 검사', () => {
  it('기본값을 채우고 허용 출처를 목록으로 나눈다', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://local/db', CORS_ORIGINS: 'http://a.test, http://b.test,' });
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: 'postgresql://local/db',
      CORS_ORIGINS: ['http://a.test', 'http://b.test'],
    });
  });

  it('DB 주소가 없거나 포트가 숫자가 아니면 기동을 멈춘다', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://local/db', PORT: 'abc' })).toThrow(/PORT/);
  });
});
