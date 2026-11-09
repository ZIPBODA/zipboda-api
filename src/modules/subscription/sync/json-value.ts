import type { Prisma } from '@/database/generated/client.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/**
 * 원천 응답(unknown)을 JSON 열에 넣을 값으로 확인한다 — 함수·bigint·undefined가 섞이면 DB가 조용히 바꿔 저장하지 않게 멈춘다.
 * JSON.parse로 받은 값은 늘 통과한다
 */
export const jsonValueOf = (value: unknown): Prisma.InputJsonValue => {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => (item === null ? null : jsonValueOf(item)));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, item === null ? null : jsonValueOf(item)]),
    );
  }
  throw new Error(`JSON으로 저장할 수 없는 값입니다: ${typeof value}`);
};
