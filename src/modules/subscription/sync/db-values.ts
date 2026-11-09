import type { Prisma } from '@/database/generated/client.js';

/** date 열은 UTC 자정으로 읽고 쓴다(목록 SQL·매퍼와 같은 규칙) */
export const dateOf = (iso: string | null): Date | null => (iso === null ? null : new Date(`${iso}T00:00:00Z`));

/**
 * time 열에는 Date의 UTC 시·분이 그대로 들어간다. 원천이 준 한국 시각("10:00")을 시간대 변환 없이 담으려고
 * UTC로 만든다 — 지역 시간으로 만들면 서버 시간대에 따라 저장 값이 바뀐다
 */
export const timeOf = (hourMinute: string | null): Date | null =>
  hourMinute === null ? null : new Date(`1970-01-01T${hourMinute}:00Z`);

/**
 * 같은 공고·단지를 두 트랜잭션이 동시에 처음 만들면 부분 UNIQUE에 걸려 한쪽 공고 저장 전체가 롤백된다. Postgres는 제약 위반 뒤
 * 트랜잭션을 되살릴 수 없어, 찾기 전에 키마다 트랜잭션 잠금을 잡는다. 잠금 순서가 엇갈리면 교착이 생겨 정렬한 순서로 잡는다
 */
export const lockKeys = async (tx: Prisma.TransactionClient, keys: Iterable<string>): Promise<void> => {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
};
