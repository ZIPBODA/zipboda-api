import { Prisma, type PrismaClient } from '@/database/generated/client.js';
import {
  STALE_SYNC_RUN_MS,
  SyncStatus,
  type NoticeSourceName,
  type SyncLevel,
  type SyncStage,
  type SyncTrigger,
} from '../constants.js';
import { jsonValueOf } from './json-value.js';
import type { NormalizationWarning } from './normalized-notice.js';

/** 오류 메시지가 길면(DB 오류 전문 등) 기록을 무겁게 해 앞부분만 남긴다 */
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

export class SyncAlreadyRunningError extends Error {
  constructor(readonly source: string) {
    super(`${source} 동기화가 이미 돌고 있다`);
    this.name = 'SyncAlreadyRunningError';
  }
}

export interface SyncRunCounts {
  fetched: number;
  created: number;
  updated: number;
  failed: number;
}

const clip = (message: string): string => message.slice(0, MAX_ERROR_MESSAGE_LENGTH);

/** 동기화 실행 이력(sync_runs)과 실패·경고(sync_failures)를 남긴다(ERD §4.9·4.10) */
export class SyncRunRecorder {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 같은 원천은 한 번에 하나만 돈다(부분 UNIQUE). 오래 RUNNING으로 남은 실행은 비정상 종료로 보고 먼저 정리한다 */
  async start(source: NoticeSourceName, trigger: SyncTrigger): Promise<string> {
    const now = this.now();
    await this.prisma.syncRun.updateMany({
      where: { source, status: SyncStatus.RUNNING, startedAt: { lt: new Date(now.getTime() - STALE_SYNC_RUN_MS) } },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: now,
        errorMessage: '끝나지 않은 채 오래 남아 다음 실행이 정리했다',
      },
    });
    try {
      const run = await this.prisma.syncRun.create({
        data: { source, trigger, status: SyncStatus.RUNNING, startedAt: now },
        select: { id: true },
      });
      return run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new SyncAlreadyRunningError(source);
      }
      throw error;
    }
  }

  /**
   * 아직 RUNNING일 때만 결과를 남긴다. 너무 오래 걸려 다음 실행이 FAILED로 정리한 실행이 그 기록을 덮어쓰지 않게 —
   * 덮어쓰지 않았으면 false
   */
  async finish(
    runId: string,
    status: SyncStatus,
    counts: SyncRunCounts,
    errorMessage: string | null = null,
  ): Promise<boolean> {
    const { count } = await this.prisma.syncRun.updateMany({
      where: { id: runId, status: SyncStatus.RUNNING },
      data: {
        status,
        finishedAt: this.now(),
        fetchedCount: counts.fetched,
        createdCount: counts.created,
        updatedCount: counts.updated,
        failedCount: counts.failed,
        errorMessage: errorMessage === null ? null : clip(errorMessage),
      },
    });
    return count > 0;
  }

  /**
   * 같은 문제(원천·원천 키·단계·코드)가 아직 열려 있으면 행을 늘리지 않고 retry_count를 올린다 — 부분 UNIQUE(미해결)에 맞춘
   * ON CONFLICT라 Prisma upsert로는 쓸 수 없다
   */
  async record(
    runId: string,
    source: NoticeSourceName,
    sourceKey: string | null,
    level: SyncLevel,
    warning: NormalizationWarning,
    payload: unknown = null,
  ): Promise<void> {
    const payloadText = payload === null ? null : JSON.stringify(jsonValueOf(payload));
    await this.prisma.$executeRaw`
      INSERT INTO sync_failures (id, sync_run_id, source, source_key, stage, level, error_code, error_message, payload)
      VALUES (gen_random_uuid(), ${runId}::uuid, ${source}, ${sourceKey}, ${warning.stage}, ${level}, ${warning.code},
        ${clip(warning.message)}, ${payloadText}::jsonb)
      ON CONFLICT (source, source_key, stage, error_code) WHERE resolved_at IS NULL
      DO UPDATE SET sync_run_id = EXCLUDED.sync_run_id, level = EXCLUDED.level, error_message = EXCLUDED.error_message,
        payload = EXCLUDED.payload, retry_count = sync_failures.retry_count + 1`;
  }

  /** 이번에 다시 나지 않은 이 공고의 문제는 해결된 것으로 닫는다(관리자 재처리 큐에서 빠진다) */
  async resolveExcept(source: NoticeSourceName, sourceKey: string, stillOpen: NormalizationWarning[]): Promise<void> {
    const open = await this.prisma.syncFailure.findMany({
      where: { source, sourceKey, resolvedAt: null },
      select: { id: true, stage: true, errorCode: true },
    });
    const keep = new Set(stillOpen.map((warning) => `${warning.stage}:${warning.code}`));
    const resolved = open.filter((row) => !keep.has(`${row.stage}:${row.errorCode}`)).map((row) => row.id);
    if (resolved.length > 0) {
      await this.prisma.syncFailure.updateMany({ where: { id: { in: resolved } }, data: { resolvedAt: this.now() } });
    }
  }

  /** 여러 원천 키의 열린 문제를 한 번에 닫는다 — 목록에서 수집 범위 밖으로 걸러진 공고(청약홈 민간 분양 등)는 수가 많아 하나씩 보지 않는다 */
  async resolveAll(source: NoticeSourceName, sourceKeys: string[]): Promise<void> {
    if (sourceKeys.length === 0) return;
    await this.prisma.syncFailure.updateMany({
      where: { source, sourceKey: { in: sourceKeys }, resolvedAt: null },
      data: { resolvedAt: this.now() },
    });
  }

  /** 한 키의 한 단계에서 지금 남길 코드 밖의 문제를 닫는다 — 같은 키의 다른 단계(단지 좌표 등) 경고는 건드리지 않는다 */
  async resolveStageExcept(sourceKey: string, stage: SyncStage, stillOpenCode: string): Promise<void> {
    await this.prisma.syncFailure.updateMany({
      where: { sourceKey, stage, errorCode: { not: stillOpenCode }, resolvedAt: null },
      data: { resolvedAt: this.now() },
    });
  }

  /**
   * 여러 원천 키의 한 단계 문제를 한 번에 닫는다(지오코딩처럼 단지마다 하나씩 남는 경고). 단지 좌표는 원천과 상관없는 값이라
   * 어느 원천의 실행이 남긴 경고든 닫는다 — LH 실행이 남긴 경고를 청약홈 실행이 좌표를 얻어 닫을 수 있게
   */
  async resolveStage(sourceKeys: string[], stage: SyncStage): Promise<void> {
    if (sourceKeys.length === 0) return;
    await this.prisma.syncFailure.updateMany({
      where: { sourceKey: { in: sourceKeys }, stage, resolvedAt: null },
      data: { resolvedAt: this.now() },
    });
  }
}
