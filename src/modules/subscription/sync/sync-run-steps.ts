import type { PrismaClient } from '@/database/generated/client.js';
import {
  GEOCODE_BATCH_SIZE,
  SyncLevel,
  SyncStage,
  SyncStatus,
  type NoticeSourceName,
  type SyncTrigger,
} from '../constants.js';
import { geocodePendingComplexes } from './geocode/complex-geocoding.js';
import type { Geocoder } from './geocode/kakao-geocoder.js';
import type { NormalizationWarning, NormalizeResult } from './normalized-notice.js';
import type { NoticeWriter, WriteResult } from './notice-writer.js';
import type { SyncRunRecorder } from './sync-run-recorder.js';
import { mergeWarnings } from './warnings.js';

/** 원천마다 수집기를 따로 두되(목록·다시 받기 판단이 원천마다 다르다) 정규화 뒤 저장·기록·좌표는 이 단계들을 함께 쓴다 */

const PROGRESS_EVERY = 50;

export interface SyncDependencies {
  prisma: PrismaClient;
  writer: NoticeWriter;
  recorder: SyncRunRecorder;
  /** 없으면 좌표를 채우지 않는다(카카오 키가 없을 때) */
  geocoder: Geocoder | null;
  now: () => Date;
  log: (message: string) => void;
}

export interface SyncOptions {
  trigger: SyncTrigger;
  /** 공고 게시일 범위 YYYYMMDD */
  from: string;
  to: string;
  /** 바뀌지 않은 공고도 상세를 다시 부른다 */
  full: boolean;
}

export interface SyncSummary {
  runId: string;
  status: SyncStatus;
  /** 목록에서 찾은 공고(겹친 공고는 한 번) */
  listed: number;
  /** 상세를 받은 공고 */
  fetched: number;
  /** 바뀌지 않아 다시 부르지 않은 공고 */
  skipped: number;
  /** 시간 한도를 넘어 다음 실행에 넘긴 공고 */
  deferred: number;
  created: number;
  updated: number;
  /** 원천 참조만 더한 공고(정정본보다 늦게 받은 원 공고, 다른 원천에 이미 있는 같은 공고) */
  referenced: number;
  excluded: number;
  unclassified: number;
  /** 저장하지 못한 공고와 실패한 목록 조회 */
  failed: number;
  warnings: number;
  geocoded: number;
  notFound: number;
  /** 좌표 찾기를 남은 단지를 두고 멈춘 까닭(호출 한도 초과 등). 끝까지 했으면 null */
  geocodeStopped: string | null;
}

export const emptySummaryOf = (runId: string): SyncSummary => ({
  runId,
  status: SyncStatus.RUNNING,
  listed: 0,
  fetched: 0,
  skipped: 0,
  deferred: 0,
  created: 0,
  updated: 0,
  referenced: 0,
  excluded: 0,
  unclassified: 0,
  failed: 0,
  warnings: 0,
  geocoded: 0,
  notFound: 0,
  geocodeStopped: null,
});

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 실패가 없으면 성공. 목록 조회만 실패했거나 저장·건너뜀이 하나라도 있으면 일부 실패. 받으려던 공고가 하나도 저장되지 않았으면
 * 실패다(목록이 모두 실패한 경우는 수집기가 먼저 끝낸다)
 */
export const statusOf = (summary: SyncSummary, listFailures: number): SyncStatus => {
  if (summary.failed === 0) return SyncStatus.SUCCEEDED;
  const noticeFailures = summary.failed - listFailures;
  const savedOrKept = summary.created + summary.updated + summary.referenced + summary.skipped > 0;
  return noticeFailures > 0 && !savedOrKept ? SyncStatus.FAILED : SyncStatus.PARTIAL;
};

/** 실행 결과를 남긴다. 너무 오래 걸려 다음 실행이 이미 FAILED로 정리했으면 덮어쓰지 않는다 */
export const finishRun = async (deps: SyncDependencies, summary: SyncSummary, errorMessage: string | null) => {
  const counts = {
    fetched: summary.fetched,
    created: summary.created,
    updated: summary.updated,
    failed: summary.failed,
  };
  if (!(await deps.recorder.finish(summary.runId, summary.status, counts, errorMessage))) {
    deps.log('실행이 너무 오래 걸려 다음 실행이 FAILED로 정리했다 — 이 실행의 결과는 기록하지 않는다');
  }
};

/**
 * 일꾼 여럿이 공고를 나눠 처리한다. 시간 한도를 넘기면 새 공고를 시작하지 않고, 남긴 수를 돌려준다. 기록조차 못 하는
 * 오류(DB 끊김 등)가 나면 다른 일꾼은 하던 공고까지만 하고 멈춘 뒤 그 오류를 던진다 — 모두 멈춘 뒤라 닫힌 실행에 기록이
 * 이어지거나 DB 연결이 쓰는 도중에 끊기지 않는다
 */
export const processInPool = async <T>(
  items: readonly T[],
  { concurrency, overBudget, log }: { concurrency: number; overBudget: () => boolean; log: (message: string) => void },
  work: (item: T) => Promise<void>,
): Promise<number> => {
  const queue = [...items];
  let done = 0;
  let aborted = false;
  const worker = async () => {
    try {
      while (!aborted && !overBudget()) {
        const next = queue.shift();
        if (next === undefined) return;
        await work(next);
        done += 1;
        if (done % PROGRESS_EVERY === 0) log(`${done}/${items.length}건 처리`);
      }
    } catch (error) {
      aborted = true;
      throw error;
    }
  };
  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure !== undefined) {
    throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
  }
  return queue.length;
};

/** 이번 경고를 남기고, 이번에 다시 나지 않은 이 공고의 문제(지난 실패 포함)는 닫는다 */
export const recordWarnings = async (
  deps: SyncDependencies,
  source: NoticeSourceName,
  summary: SyncSummary,
  key: string,
  warnings: NormalizationWarning[],
  alsoOpen: NormalizationWarning[] = [],
): Promise<void> => {
  for (const warning of warnings) {
    await deps.recorder.record(summary.runId, source, key, SyncLevel.WARNING, warning);
  }
  summary.warnings += warnings.length;
  await deps.recorder.resolveExcept(source, key, [...warnings, ...alsoOpen]);
};

/**
 * 원천 응답(raw)을 정규화해 저장하고 결과를 기록한다(ERD §5 규칙 17). 정규화 중 예상 못 한 오류·읽을 수 없는 응답·저장 실패는
 * 이 공고만 ERROR로 남기고 다음 공고로 간다. 저장은 한 번 더 시도한다 — 원천이 다른 수집과 엇갈려 생긴 교착·잠금 대기
 * 초과는 다시 하면 대개 되고, 저장은 같은 입력이면 같은 결과라 안전하다. 정규화 뒤 수집 범위 밖으로 판정된 공고는 원천마다
 * 남길 것이 달라 onExcluded에 맡긴다
 */
export const normalizeAndSave = async (
  deps: SyncDependencies,
  source: NoticeSourceName,
  summary: SyncSummary,
  key: string,
  raw: unknown,
  normalize: () => NormalizeResult,
  onExcluded: (result: Extract<NormalizeResult, { kind: 'excluded' }>) => Promise<void>,
): Promise<void> => {
  const { recorder, writer, now } = deps;
  let result: NormalizeResult;
  try {
    result = normalize();
  } catch (error) {
    summary.failed += 1;
    const warning = { stage: SyncStage.NORMALIZE, code: 'NORMALIZE_FAILED', message: messageOf(error) };
    await recorder.record(summary.runId, source, key, SyncLevel.ERROR, warning, raw);
    return;
  }
  if (result.kind === 'invalid') {
    summary.failed += 1;
    await recorder.record(summary.runId, source, key, SyncLevel.ERROR, result.warning, raw);
    return;
  }
  if (result.kind === 'unclassified') {
    summary.unclassified += 1;
    await recorder.record(summary.runId, source, key, SyncLevel.WARNING, result.warning);
    await recorder.resolveExcept(source, key, [result.warning]);
    return;
  }
  if (result.kind === 'excluded') {
    summary.excluded += 1;
    await onExcluded(result);
    return;
  }
  let written: WriteResult;
  try {
    written = await writer.write(result.notice, raw, now()).catch(() => writer.write(result.notice, raw, now()));
  } catch (error) {
    summary.failed += 1;
    const warning = { stage: SyncStage.SAVE, code: 'WRITE_FAILED', message: messageOf(error) };
    await recorder.record(summary.runId, source, key, SyncLevel.ERROR, warning, raw);
    return;
  }
  if (written.createdNotice) summary.created += 1;
  else if (written.primary) summary.updated += 1;
  else summary.referenced += 1;
  await recordWarnings(deps, source, summary, key, mergeWarnings([...result.notice.warnings, ...written.warnings]));
};

/** 지오코딩 경고는 공고가 아니라 단지에 남는다 */
const complexKeyOf = (complexId: string): string => `complex:${complexId}`;

/** 주소가 있고 아직 좌표가 없는 단지의 좌표를 채운다(ERD §5 규칙 17). 경고는 이 실행의 원천으로 남긴다 */
export const geocodeStep = async (
  deps: SyncDependencies,
  source: NoticeSourceName,
  summary: SyncSummary,
  overBudget: () => boolean,
): Promise<void> => {
  const { geocoder, prisma, recorder } = deps;
  if (geocoder === null) return;
  const result = await geocodePendingComplexes(prisma, geocoder, { limit: GEOCODE_BATCH_SIZE, shouldStop: overBudget });
  summary.geocoded = result.geocoded;
  summary.notFound = result.notFound;
  summary.geocodeStopped = result.stoppedBy;
  summary.warnings += result.failures.length;
  for (const failure of result.failures) {
    await recorder.record(summary.runId, source, complexKeyOf(failure.complexId), SyncLevel.WARNING, {
      stage: SyncStage.GEOCODE,
      code: failure.code,
      message: '좌표를 얻지 못해 다음 실행에서 다시 시도한다',
    });
  }
  await recorder.resolveStage(
    result.settledIds.map((complexId) => complexKeyOf(complexId)),
    SyncStage.GEOCODE,
  );
};
