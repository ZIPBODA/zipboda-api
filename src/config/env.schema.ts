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

/** 앱이 뜰 때 한 번 검사한다 — 빠진 설정은 첫 요청이 아니라 기동 단계에서 드러나야 한다 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: commaSeparated,
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`환경 변수 설정 오류: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
};
