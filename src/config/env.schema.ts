import { z } from 'zod';

const DEFAULT_PORT = 4000;

const commaSeparated = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const MIN_JWT_SECRET_LENGTH = 32;
const AES_256_KEY_BYTES = 32;
const MIN_HMAC_KEY_BYTES = 32;

const base64Bytes = (value: string): Buffer => Buffer.from(value, 'base64');
/** Buffer.from은 base64가 아닌 글자를 조용히 버려, 되돌려 같은지까지 봐야 잘못 붙여 넣은 키를 막는다 */
const isBase64 = (value: string): boolean => base64Bytes(value).toString('base64') === value;

const base64Key = (description: string, isValidLength: (bytes: number) => boolean) =>
  z.string().refine((value) => isBase64(value) && isValidLength(base64Bytes(value).length), { message: description });

/** 앱이 뜰 때 한 번 검사한다 — 빠진 설정은 첫 요청이 아니라 기동 단계에서 드러나야 한다 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: commaSeparated,
    JWT_ACCESS_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH),
    PII_ENCRYPTION_KEY: base64Key('base64로 32바이트여야 합니다', (bytes) => bytes === AES_256_KEY_BYTES),
    PII_HASH_KEY: base64Key('base64로 32바이트 이상이어야 합니다', (bytes) => bytes >= MIN_HMAC_KEY_BYTES),
  })
  // 한 키를 암호화와 HMAC 두 용도에 쓰지 않는다 — 한쪽 키가 새면 다른 쪽까지 함께 깨진다(ERD §5 규칙 21)
  .refine((env) => env.PII_HASH_KEY !== env.PII_ENCRYPTION_KEY, {
    path: ['PII_HASH_KEY'],
    message: '암호화 키와 다른 값이어야 합니다',
  });

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`환경 변수 설정 오류: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
};
