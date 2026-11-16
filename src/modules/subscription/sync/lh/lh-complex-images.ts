import type { PrismaClient } from '@/database/generated/client.js';
import { NoticeSourceName, SyncLevel, SyncStage } from '../../constants.js';
import { COMPLEX_KEY_PREFIX, complexKeyOf, type SyncDependencies, type SyncSummary } from '../sync-run-steps.js';
import { LhApiError } from './lh-api.client.js';
import { imageInViewerPage, isLhImageViewerUrl } from './lh-image-url.js';
import {
  LH_IMAGE_BATCH_SIZE,
  LH_IMAGE_MAX_CONSECUTIVE_FAILURES,
  LH_IMAGE_TIME_BUDGET_MS,
  LH_IMAGE_VIEWER,
} from './lh.constants.js';

export interface LhImagePageSource {
  imagePageOf(url: string): Promise<string>;
}

export const LhImageCode = {
  /** LH가 파일이 없다고 알린 페이지(`<img src="">`) — 사진 없음으로 둔다 */
  NOT_IN_PAGE: 'IMAGE_NOT_IN_PAGE',
  /** 오류·점검 페이지나 모양이 바뀐 페이지 — 사진 없음으로 단정하지 않고 보기 주소를 남긴다 */
  PAGE_UNEXPECTED: 'IMAGE_PAGE_UNEXPECTED',
  UNKNOWN: 'IMAGE_UNKNOWN',
} as const;

export const LhImageStopReason = { CONSECUTIVE_FAILURES: 'CONSECUTIVE_FAILURES', TIME_BUDGET: 'TIME_BUDGET' } as const;

const VIEWER_PREFIX = `https://${LH_IMAGE_VIEWER.host}${LH_IMAGE_VIEWER.path}`;

export interface LhImageOptions {
  limit: number;
  /** 시간 상한을 넘으면 남은 단지는 다음 실행에 넘긴다 */
  shouldStop: () => boolean;
}

export interface LhImageResult {
  resolved: number;
  /** 사진 주소로 바꿨거나 그새 다른 값이 된 단지 — 지난 실행의 사진 경고를 닫는다 */
  settledIds: string[];
  /** 사진 없음으로 둔 단지 — 이 경고만 남기고 같은 단계의 다른 경고는 닫는다 */
  missingIds: string[];
  /** 바꾸지 못한 단지. NOT_IN_PAGE 밖은 보기 주소를 남겨 다음 실행이 다시 시도한다 */
  failures: { complexId: string; code: string }[];
  stoppedBy: string | null;
}

type PageOutcome = { kind: 'IMAGE'; url: string } | { kind: 'MISSING' } | { kind: 'FAILED'; code: string };

const outcomeOf = async (source: LhImagePageSource, pageUrl: string): Promise<PageOutcome> => {
  let html: string;
  try {
    html = await source.imagePageOf(pageUrl);
  } catch (error) {
    return { kind: 'FAILED', code: error instanceof LhApiError ? error.code : LhImageCode.UNKNOWN };
  }
  const image = imageInViewerPage(html, pageUrl);
  return image.kind === 'UNEXPECTED' ? { kind: 'FAILED', code: LhImageCode.PAGE_UNEXPECTED } : image;
};

/**
 * 바꿀 단지 — 오래된 순이되, 지난 실행에서 실패한 단지는 뒤로 미룬다. 계속 실패하는 단지가 앞을 막으면
 * 연속 실패로 멈춰 뒤의 단지를 영영 바꾸지 못한다
 */
const pendingComplexes = async (prisma: PrismaClient, limit: number) => {
  const failing = await prisma.syncFailure.findMany({
    where: { stage: SyncStage.FETCH, resolvedAt: null, sourceKey: { startsWith: COMPLEX_KEY_PREFIX } },
    select: { sourceKey: true },
  });
  const failingIds = [...new Set(failing.map((row) => (row.sourceKey ?? '').slice(COMPLEX_KEY_PREFIX.length)))];
  const query = (ids: { in: string[] } | { notIn: string[] }, take: number) =>
    prisma.complex.findMany({
      where: { imageUrl: { startsWith: VIEWER_PREFIX }, id: ids },
      select: { id: true, imageUrl: true },
      orderBy: { createdAt: 'asc' },
      take,
    });
  const fresh = await query({ notIn: failingIds }, limit);
  const retry = fresh.length < limit ? await query({ in: failingIds }, limit - fresh.length) : [];
  return [...fresh, ...retry];
};

/**
 * 단지 사진이 아직 보기 페이지 주소인 단지를 실제 사진 주소로 바꾼다. 원천이 다시 보기 주소를 주더라도 단지 사진은
 * 비어 있을 때만 채우므로(complex-resolver) 한 번 바꾼 주소는 남는다
 */
export const resolveLhComplexImages = async (
  prisma: PrismaClient,
  source: LhImagePageSource,
  { limit, shouldStop }: LhImageOptions,
): Promise<LhImageResult> => {
  const result: LhImageResult = { resolved: 0, settledIds: [], missingIds: [], failures: [], stoppedBy: null };
  let consecutiveFailures = 0;
  for (const { id, imageUrl: pageUrl } of await pendingComplexes(prisma, limit)) {
    if (pageUrl === null || !isLhImageViewerUrl(pageUrl)) continue;
    if (shouldStop()) {
      result.stoppedBy = LhImageStopReason.TIME_BUDGET;
      break;
    }
    const outcome = await outcomeOf(source, pageUrl);
    if (outcome.kind === 'FAILED') {
      result.failures.push({ complexId: id, code: outcome.code });
      consecutiveFailures += 1;
      if (consecutiveFailures >= LH_IMAGE_MAX_CONSECUTIVE_FAILURES) {
        result.stoppedBy = LhImageStopReason.CONSECUTIVE_FAILURES;
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    const imageUrl = outcome.kind === 'IMAGE' ? outcome.url : null;
    // 읽는 사이에 관리자가 사진을 바꿨으면 덮지 않는다 — 그 단지는 더 바꿀 것이 없다
    const { count } = await prisma.complex.updateMany({ where: { id, imageUrl: pageUrl }, data: { imageUrl } });
    if (count === 0) {
      result.settledIds.push(id);
    } else if (outcome.kind === 'IMAGE') {
      result.resolved += 1;
      result.settledIds.push(id);
    } else {
      result.missingIds.push(id);
      result.failures.push({ complexId: id, code: LhImageCode.NOT_IN_PAGE });
    }
  }
  return result;
};

/** LH 수집 뒤에 단지 사진 주소를 바꾼다(ERD §5 규칙 16). 실패는 단지 키에 수집 단계(FETCH) 경고로 남긴다 */
export const lhImageStep = async (
  deps: SyncDependencies,
  source: LhImagePageSource,
  summary: SyncSummary,
  overBudget: () => boolean,
): Promise<void> => {
  const { prisma, recorder, log, now } = deps;
  const startedAt = now().getTime();
  const shouldStop = () => overBudget() || now().getTime() - startedAt > LH_IMAGE_TIME_BUDGET_MS;
  const result = await resolveLhComplexImages(prisma, source, { limit: LH_IMAGE_BATCH_SIZE, shouldStop });
  summary.imagesResolved = result.resolved;
  summary.warnings += result.failures.length;
  for (const failure of result.failures) {
    await recorder.record(summary.runId, NoticeSourceName.LH, complexKeyOf(failure.complexId), SyncLevel.WARNING, {
      stage: SyncStage.FETCH,
      code: failure.code,
      message:
        failure.code === LhImageCode.NOT_IN_PAGE
          ? 'LH가 단지 사진 파일이 없다고 알려 사진 없음으로 둔다'
          : '단지 사진 보기 페이지에서 사진을 얻지 못해 다음 실행에서 다시 시도한다',
    });
  }
  // 사진 없음으로 둔 단지는 더 다시 시도하지 않으므로 '다시 시도한다'던 지난 경고를 닫는다
  for (const complexId of result.missingIds) {
    await recorder.resolveStageExcept(complexKeyOf(complexId), SyncStage.FETCH, LhImageCode.NOT_IN_PAGE);
  }
  await recorder.resolveStage(result.settledIds.map(complexKeyOf), SyncStage.FETCH);
  if (result.stoppedBy !== null)
    log(`단지 사진 주소 바꾸기를 멈췄다(${result.stoppedBy}) — 남은 단지는 다음 실행에서 바꾼다`);
};
