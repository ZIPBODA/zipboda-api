import type { PrismaClient } from '@/database/generated/client.js';
import { NoticeSourceName, SyncLevel, SyncStage, SyncStatus, type SyncTrigger } from '../../constants.js';
import { geocodePendingComplexes } from '../geocode/complex-geocoding.js';
import type { Geocoder } from '../geocode/kakao-geocoder.js';
import type { NormalizationWarning, NormalizedNotice, NormalizeResult } from '../normalized-notice.js';
import type { NoticeWriter, WriteResult } from '../notice-writer.js';
import type { SyncRunRecorder } from '../sync-run-recorder.js';
import { mergeWarnings } from '../warnings.js';
import { LhApiError, type LhListQuery } from './lh-api.client.js';
import { classifyLhNotice } from './lh-classify.js';
import { normalizeLhNotice } from './lh-normalizer.js';
import {
  GEOCODE_BATCH_SIZE,
  LH_CLOSED_STATUS,
  LH_LINK_SYSTEM,
  LH_LIST_COMPARED_FIELDS,
  LH_MAX_LIST_PAGES,
  LH_PAGE_SIZE,
  LH_QUERY_REGIONS,
  LH_REFRESH_ACTIVE_MS,
  LH_RUN_TIME_BUDGET_MS,
  LH_SYNC_CONCURRENCY,
  LH_UPPER_TYPES,
} from './lh.constants.js';
import type { LhNoticeBundle, LhRow } from './lh-raw.js';

const SOURCE = NoticeSourceName.LH;
const PROGRESS_EVERY = 50;
const KNOWN_LINK_SYSTEMS: readonly string[] = Object.values(LH_LINK_SYSTEM);

/** 받았지만 수집 지역 안에 남는 칸이 없어 저장하지 않은 공고. 저장 기록이 없어, 이 경고에 남긴 목록 행으로 다시 받을지 정한다 */
const NO_LISTING_IN_REGION = 'NO_LISTING_IN_REGION';

/** 수집기가 쓰는 LH API — 테스트는 저장해 둔 실제 응답으로 바꿔 끼운다 */
export interface LhSource {
  listNotices(query: LhListQuery): Promise<LhRow[]>;
  bundleOf(notice: LhRow, queryRegion: string): Promise<LhNoticeBundle>;
}

export interface LhSyncDependencies {
  prisma: PrismaClient;
  lh: LhSource;
  writer: NoticeWriter;
  recorder: SyncRunRecorder;
  /** 없으면 좌표를 채우지 않는다(카카오 키가 없을 때) */
  geocoder: Geocoder | null;
  now: () => Date;
  log: (message: string) => void;
}

export interface LhSyncOptions {
  trigger: SyncTrigger;
  /** 공고 게시일 범위 YYYYMMDD */
  from: string;
  to: string;
  /** 바뀌지 않은 공고도 상세·공급정보를 다시 부른다 */
  full: boolean;
}

export interface LhSyncSummary {
  runId: string;
  status: SyncStatus;
  /** 목록에서 찾은 공고(조회 지역이 달라 겹친 공고는 한 번) */
  listed: number;
  /** 상세·공급정보를 받은 공고 */
  fetched: number;
  /** 바뀌지 않아 다시 부르지 않은 공고 */
  skipped: number;
  /** 시간 한도를 넘어 다음 실행에 넘긴 공고 */
  deferred: number;
  created: number;
  updated: number;
  /** 정정 묶음에 원천 참조만 더한 공고(정정본보다 늦게 받은 원 공고 등) */
  referenced: number;
  excluded: number;
  unclassified: number;
  /** 저장하지 못한 공고와 실패한 목록 조합(지역×유형) */
  failed: number;
  warnings: number;
  geocoded: number;
  notFound: number;
  /** 좌표 찾기를 남은 단지를 두고 멈춘 까닭(호출 한도 초과 등). 끝까지 했으면 null */
  geocodeStopped: string | null;
}

interface Candidate {
  key: string;
  row: LhRow;
  /** 목록을 조회한 지역 — 이미 받은 공고는 처음 받은 지역으로 고정한다(ERD §5 규칙 15) */
  region: string;
}

/** 지난번에 받은 목록 행·조회 지역·받은 때. 저장한 공고는 원천 응답에서, 남는 칸이 없던 공고는 그 경고에서 읽는다 */
interface PreviousFetch {
  queryRegion: unknown;
  row: Record<string, unknown> | null;
  fetchedAt: Date | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sourceKeyOf = (row: LhRow): string => `${row.CCR_CNNT_SYS_DS_CD}:${row.PAN_ID}`;

/** 지오코딩 경고는 공고가 아니라 단지에 남는다 */
const complexKeyOf = (complexId: string): string => `complex:${complexId}`;

const listFingerprintOf = (row: Record<string, unknown>): string =>
  JSON.stringify(LH_LIST_COMPARED_FIELDS.map((field) => row[field] ?? null));

const previousOf = (payload: unknown, fetchedAt: Date | null): PreviousFetch => ({
  queryRegion: isRecord(payload) ? payload.queryRegion : null,
  row: isRecord(payload) && isRecord(payload.notice) ? payload.notice : null,
  fetchedAt,
});

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 실패가 없으면 성공. 목록 조합만 실패했거나 저장·건너뜀이 하나라도 있으면 일부 실패. 받으려던 공고가 하나도 저장되지 않았으면
 * 실패다(목록이 모두 실패한 경우는 run에서 먼저 끝낸다)
 */
const statusOf = (summary: LhSyncSummary, listFailures: number): SyncStatus => {
  if (summary.failed === 0) return SyncStatus.SUCCEEDED;
  const noticeFailures = summary.failed - listFailures;
  const savedOrKept = summary.created + summary.updated + summary.referenced + summary.skipped > 0;
  return noticeFailures > 0 && !savedOrKept ? SyncStatus.FAILED : SyncStatus.PARTIAL;
};

/**
 * LH 공고 수집 한 번(API-114, ERD §5 규칙 17). 서울 → 인천 → 경기 순으로 지역×유형 목록을 돌며 같은 공고는 한 번만 처리하고,
 * 바뀐 공고만 상세·공급정보를 받아 정규화해 저장한다. 공고 하나가 실패해도 나머지는 계속한다
 */
export class LhSyncRunner {
  constructor(private readonly deps: LhSyncDependencies) {}

  async run(options: LhSyncOptions): Promise<LhSyncSummary> {
    const { recorder, log, now } = this.deps;
    const runId = await recorder.start(SOURCE, options.trigger);
    const startedAt = now().getTime();
    const overBudget = () => now().getTime() - startedAt > LH_RUN_TIME_BUDGET_MS;
    const summary: LhSyncSummary = {
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
    };
    const finish = async (errorMessage: string | null) => {
      const counts = {
        fetched: summary.fetched,
        created: summary.created,
        updated: summary.updated,
        failed: summary.failed,
      };
      if (!(await recorder.finish(runId, summary.status, counts, errorMessage))) {
        log('실행이 너무 오래 걸려 다음 실행이 FAILED로 정리했다 — 이 실행의 결과는 기록하지 않는다');
      }
    };
    try {
      const { candidates, listSucceeded, listFailures } = await this.collect(runId, options, summary);
      if (listSucceeded === 0 && listFailures > 0) {
        summary.status = SyncStatus.FAILED;
        await finish('목록 조회가 모두 실패했다');
        return summary;
      }
      const collectable = await this.classify(runId, candidates, summary);
      const previous = await this.previousFetches(collectable);
      this.pinRegions(collectable, previous);
      const changed = options.full ? collectable : await this.selectChanged(collectable, previous, summary);
      log(`목록 ${summary.listed}건 — 받을 공고 ${changed.length}건, 바뀌지 않아 건너뜀 ${summary.skipped}건`);
      await this.processAll(runId, changed, summary, overBudget);
      await this.geocode(runId, summary, overBudget);
      summary.status = statusOf(summary, listFailures);
      await finish(summary.deferred > 0 ? `시간 한도로 공고 ${summary.deferred}건을 다음 실행에 넘겼다` : null);
      return summary;
    } catch (error) {
      summary.status = SyncStatus.FAILED;
      await finish(messageOf(error));
      throw error;
    }
  }

  /** 조합(지역×유형)마다 쪽을 끝까지 받는다. 조합의 기록은 모든 쪽을 받은 뒤에 닫는다 — 2쪽 이후 실패도 같은 행에 쌓이게 */
  private async collect(runId: string, options: LhSyncOptions, summary: LhSyncSummary) {
    const { lh, recorder } = this.deps;
    const byKey = new Map<string, Candidate>();
    let listSucceeded = 0;
    let listFailures = 0;
    for (const region of Object.keys(LH_QUERY_REGIONS)) {
      for (const upperType of LH_UPPER_TYPES) {
        const listKey = `list:${region}:${upperType}`;
        let failure: LhApiError | null = null;
        let lastPageSeen = false;
        for (let page = 1; page <= LH_MAX_LIST_PAGES && !lastPageSeen; page += 1) {
          let rows: LhRow[];
          try {
            rows = await lh.listNotices({ region, upperType, from: options.from, to: options.to, page });
          } catch (error) {
            if (!(error instanceof LhApiError)) throw error;
            failure = error;
            break;
          }
          listSucceeded += 1;
          for (const row of rows) {
            const key = sourceKeyOf(row);
            if (!byKey.has(key)) byKey.set(key, { key, row, region });
          }
          lastPageSeen = rows.length < LH_PAGE_SIZE;
        }
        if (failure !== null) {
          listFailures += 1;
          summary.failed += 1;
          const warning = { stage: SyncStage.FETCH, code: failure.code, message: failure.message };
          await recorder.record(runId, SOURCE, listKey, SyncLevel.ERROR, warning);
          continue;
        }
        const stillOpen: NormalizationWarning[] = [];
        if (!lastPageSeen) {
          const warning = {
            stage: SyncStage.FETCH,
            code: 'LIST_PAGE_LIMIT',
            message: `목록이 ${LH_MAX_LIST_PAGES}쪽을 넘어 나머지를 받지 않았다`,
          };
          await recorder.record(runId, SOURCE, listKey, SyncLevel.WARNING, warning);
          stillOpen.push(warning);
        }
        await recorder.resolveExcept(SOURCE, listKey, stillOpen);
      }
    }
    summary.listed = byKey.size;
    return { candidates: [...byKey.values()], listSucceeded, listFailures };
  }

  /** 수집 범위 밖(전세임대 등)·모르는 유형은 목록 행만으로 가려 상세·공급정보를 부르지 않는다 */
  private async classify(runId: string, candidates: Candidate[], summary: LhSyncSummary): Promise<Candidate[]> {
    const { recorder } = this.deps;
    const collectable: Candidate[] = [];
    for (const candidate of candidates) {
      const { key, row, region } = candidate;
      const classification = classifyLhNotice(row);
      const linkSystem = row.CCR_CNNT_SYS_DS_CD ?? '';
      if (classification.kind === 'collect' && KNOWN_LINK_SYSTEMS.includes(linkSystem)) {
        collectable.push(candidate);
        continue;
      }
      if (classification.kind === 'exclude') {
        summary.excluded += 1;
        // 지난번에 받다 실패한 공고가 이제 범위 밖이면 다시 받지 않으니 그 기록도 닫는다
        await recorder.resolveExcept(SOURCE, key, []);
        continue;
      }
      summary.unclassified += 1;
      const what =
        classification.kind === 'unknown'
          ? `유형 ${classification.typeKey}(${row.UPP_AIS_TP_NM}/${row.AIS_TP_CD_NM})`
          : `연계시스템 ${linkSystem}`;
      const warning = { stage: SyncStage.NORMALIZE, code: 'UNCLASSIFIED_TYPE', message: `분류표에 없는 ${what}` };
      await recorder.record(runId, SOURCE, key, SyncLevel.WARNING, warning, { queryRegion: region, notice: row });
      await recorder.resolveExcept(SOURCE, key, [warning]);
    }
    return collectable;
  }

  private async previousFetches(candidates: Candidate[]): Promise<Map<string, PreviousFetch>> {
    const keys = candidates.map((candidate) => candidate.key);
    const [sources, noListings] = await Promise.all([
      this.deps.prisma.noticeSource.findMany({
        where: { source: SOURCE, sourceKey: { in: keys } },
        select: { sourceKey: true, rawPayload: true, fetchedAt: true },
      }),
      this.deps.prisma.syncFailure.findMany({
        where: { source: SOURCE, sourceKey: { in: keys }, errorCode: NO_LISTING_IN_REGION, resolvedAt: null },
        select: { sourceKey: true, payload: true, syncRun: { select: { startedAt: true } } },
      }),
    ]);
    const previous = new Map<string, PreviousFetch>();
    for (const row of noListings) {
      if (row.sourceKey !== null) previous.set(row.sourceKey, previousOf(row.payload, row.syncRun.startedAt));
    }
    for (const row of sources) previous.set(row.sourceKey, previousOf(row.rawPayload, row.fetchedAt));
    return previous;
  }

  /** 여러 조회 지역에 나오는 공고는 이번 목록에서 먼저 나온 지역이 아니라 처음 받은 지역으로 받는다 — 목록 조합 하나가 실패해도 칸의 지역이 바뀌지 않게 */
  private pinRegions(candidates: Candidate[], previous: Map<string, PreviousFetch>): void {
    for (const candidate of candidates) {
      const queryRegion = previous.get(candidate.key)?.queryRegion;
      if (typeof queryRegion === 'string' && Object.hasOwn(LH_QUERY_REGIONS, queryRegion)) {
        candidate.region = queryRegion;
      }
    }
  }

  /**
   * 처음 보는 공고, 목록 행이 바뀐 공고, 접수가 끝나지 않았는데 오래전에 받은 공고, 지난 실행에서 저장하지 못한 공고(미해결
   * ERROR — 갱신에 실패한 공고는 목록 행이 그대로라 이것이 없으면 다시 받지 않는다)만 받는다
   */
  private async selectChanged(
    candidates: Candidate[],
    previous: Map<string, PreviousFetch>,
    summary: LhSyncSummary,
  ): Promise<Candidate[]> {
    const openErrors = await this.deps.prisma.syncFailure.findMany({
      where: {
        source: SOURCE,
        sourceKey: { in: candidates.map((candidate) => candidate.key) },
        level: SyncLevel.ERROR,
        resolvedAt: null,
      },
      select: { sourceKey: true },
    });
    const retryKeys = new Set(openErrors.map((row) => row.sourceKey));
    const refreshBefore = this.deps.now().getTime() - LH_REFRESH_ACTIVE_MS;
    const changed = candidates.filter(({ key, row }) => {
      const last = previous.get(key);
      if (last === undefined || retryKeys.has(key)) return true;
      if (last.row === null || listFingerprintOf(last.row) !== listFingerprintOf(row)) return true;
      const active = row.PAN_SS !== LH_CLOSED_STATUS;
      return active && (last.fetchedAt === null || last.fetchedAt.getTime() < refreshBefore);
    });
    summary.skipped = candidates.length - changed.length;
    return changed;
  }

  private async processAll(
    runId: string,
    candidates: Candidate[],
    summary: LhSyncSummary,
    overBudget: () => boolean,
  ): Promise<void> {
    const queue = [...candidates];
    let done = 0;
    let aborted = false;
    const worker = async () => {
      try {
        while (!aborted && !overBudget()) {
          const next = queue.shift();
          if (next === undefined) return;
          await this.process(runId, next, summary);
          done += 1;
          if (done % PROGRESS_EVERY === 0) this.deps.log(`${done}/${candidates.length}건 처리`);
        }
      } catch (error) {
        // 기록조차 못 하는 오류(DB 끊김 등) — 다른 일꾼은 하던 공고까지만 하고 멈춘다
        aborted = true;
        throw error;
      }
    };
    // 모든 일꾼이 멈춘 뒤에 실행을 닫는다 — 닫힌 실행에 기록이 이어지거나 DB 연결이 쓰는 도중에 끊기지 않게
    const results = await Promise.allSettled(Array.from({ length: LH_SYNC_CONCURRENCY }, worker));
    summary.deferred = queue.length;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure === undefined) return;
    throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
  }

  private async process(runId: string, { key, row, region }: Candidate, summary: LhSyncSummary): Promise<void> {
    const { lh, recorder } = this.deps;
    let bundle: LhNoticeBundle;
    try {
      bundle = await lh.bundleOf(row, region);
    } catch (error) {
      if (!(error instanceof LhApiError)) throw error;
      summary.failed += 1;
      const warning = { stage: SyncStage.FETCH, code: error.code, message: error.message };
      await recorder.record(runId, SOURCE, key, SyncLevel.ERROR, warning, { queryRegion: region, notice: row });
      return;
    }
    summary.fetched += 1;
    let result: NormalizeResult;
    try {
      result = normalizeLhNotice(bundle);
    } catch (error) {
      // 원천 형식이 바뀌어 정규화가 예상 못 한 값을 만난 경우 — 이 공고만 실패로 남기고 나머지는 계속한다
      summary.failed += 1;
      const warning = { stage: SyncStage.NORMALIZE, code: 'NORMALIZE_FAILED', message: messageOf(error) };
      await recorder.record(runId, SOURCE, key, SyncLevel.ERROR, warning, bundle);
      return;
    }
    if (result.kind === 'invalid') {
      summary.failed += 1;
      await recorder.record(runId, SOURCE, key, SyncLevel.ERROR, result.warning, bundle);
      return;
    }
    if (result.kind === 'unclassified') {
      summary.unclassified += 1;
      await recorder.record(runId, SOURCE, key, SyncLevel.WARNING, result.warning);
      await recorder.resolveExcept(SOURCE, key, [result.warning]);
      return;
    }
    if (result.kind === 'excluded') {
      summary.excluded += 1;
      const noListing = { stage: SyncStage.NORMALIZE, code: NO_LISTING_IN_REGION, message: result.reason };
      await recorder.record(runId, SOURCE, key, SyncLevel.WARNING, noListing, { queryRegion: region, notice: row });
      await this.recordWarnings(runId, key, result.warnings, summary, [noListing]);
      return;
    }
    let written: WriteResult;
    try {
      written = await this.writeWithRetry(result.notice, bundle);
    } catch (error) {
      summary.failed += 1;
      const warning = { stage: SyncStage.SAVE, code: 'WRITE_FAILED', message: messageOf(error) };
      await recorder.record(runId, SOURCE, key, SyncLevel.ERROR, warning, bundle);
      return;
    }
    if (written.createdNotice) summary.created += 1;
    else if (written.primary) summary.updated += 1;
    else summary.referenced += 1;
    await this.recordWarnings(runId, key, mergeWarnings([...result.notice.warnings, ...written.warnings]), summary);
  }

  /**
   * 원천이 다른 수집과 엇갈려 생긴 교착·잠금 대기 초과는 다시 하면 대개 된다. 저장은 같은 입력이면 같은 결과가 되도록
   * 짜여 있어 한 번 더 해도 안전하다
   */
  private async writeWithRetry(notice: NormalizedNotice, bundle: LhNoticeBundle): Promise<WriteResult> {
    try {
      return await this.deps.writer.write(notice, bundle, this.deps.now());
    } catch {
      return this.deps.writer.write(notice, bundle, this.deps.now());
    }
  }

  /** 이번 경고를 남기고, 이번에 다시 나지 않은 이 공고의 문제(지난 실패 포함)는 닫는다 */
  private async recordWarnings(
    runId: string,
    key: string,
    warnings: NormalizationWarning[],
    summary: LhSyncSummary,
    alsoOpen: NormalizationWarning[] = [],
  ): Promise<void> {
    for (const warning of warnings) {
      await this.deps.recorder.record(runId, SOURCE, key, SyncLevel.WARNING, warning);
    }
    summary.warnings += warnings.length;
    await this.deps.recorder.resolveExcept(SOURCE, key, [...warnings, ...alsoOpen]);
  }

  private async geocode(runId: string, summary: LhSyncSummary, overBudget: () => boolean): Promise<void> {
    const { geocoder, prisma, recorder } = this.deps;
    if (geocoder === null) return;
    const result = await geocodePendingComplexes(prisma, geocoder, {
      limit: GEOCODE_BATCH_SIZE,
      shouldStop: overBudget,
    });
    summary.geocoded = result.geocoded;
    summary.notFound = result.notFound;
    summary.geocodeStopped = result.stoppedBy;
    summary.warnings += result.failures.length;
    for (const failure of result.failures) {
      await recorder.record(runId, SOURCE, complexKeyOf(failure.complexId), SyncLevel.WARNING, {
        stage: SyncStage.GEOCODE,
        code: failure.code,
        message: '좌표를 얻지 못해 다음 실행에서 다시 시도한다',
      });
    }
    const settledKeys = result.settledIds.map((complexId) => complexKeyOf(complexId));
    await recorder.resolveStage(SOURCE, settledKeys, SyncStage.GEOCODE);
  }
}
