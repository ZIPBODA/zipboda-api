import {
  NoticeSourceName,
  SYNC_REFRESH_ACTIVE_MS,
  SYNC_RUN_TIME_BUDGET_MS,
  SyncLevel,
  SyncStage,
  SyncStatus,
} from '../../constants.js';
import type { NormalizationWarning } from '../normalized-notice.js';
import {
  emptySummaryOf,
  finishRun,
  geocodeStep,
  messageOf,
  normalizeAndSave,
  processInPool,
  recordWarnings,
  statusOf,
  type SyncDependencies,
  type SyncOptions,
  type SyncSummary,
} from '../sync-run-steps.js';
import { LhApiError, type LhListQuery } from './lh-api.client.js';
import { classifyLhNotice } from './lh-classify.js';
import { lhImageStep, type LhImagePageSource } from './lh-complex-images.js';
import { normalizeLhNotice } from './lh-normalizer.js';
import {
  LH_CLOSED_STATUS,
  LH_LINK_SYSTEM,
  LH_LIST_COMPARED_FIELDS,
  LH_MAX_LIST_PAGES,
  LH_PAGE_SIZE,
  LH_QUERY_REGIONS,
  LH_SYNC_CONCURRENCY,
  LH_UPPER_TYPES,
} from './lh.constants.js';
import type { LhNoticeBundle, LhRow } from './lh-raw.js';

const SOURCE = NoticeSourceName.LH;
const KNOWN_LINK_SYSTEMS: readonly string[] = Object.values(LH_LINK_SYSTEM);

/** 받았지만 수집 지역 안에 남는 칸이 없어 저장하지 않은 공고. 저장 기록이 없어, 이 경고에 남긴 목록 행으로 다시 받을지 정한다 */
const NO_LISTING_IN_REGION = 'NO_LISTING_IN_REGION';

/** 수집기가 쓰는 LH API — 테스트는 저장해 둔 실제 응답으로 바꿔 끼운다 */
export interface LhSource extends LhImagePageSource {
  listNotices(query: LhListQuery): Promise<LhRow[]>;
  bundleOf(notice: LhRow, queryRegion: string): Promise<LhNoticeBundle>;
}

export interface LhSyncDependencies extends SyncDependencies {
  lh: LhSource;
}

export type LhSyncOptions = SyncOptions;
export type LhSyncSummary = SyncSummary;

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

const listFingerprintOf = (row: Record<string, unknown>): string =>
  JSON.stringify(LH_LIST_COMPARED_FIELDS.map((field) => row[field] ?? null));

const previousOf = (payload: unknown, fetchedAt: Date | null): PreviousFetch => ({
  queryRegion: isRecord(payload) ? payload.queryRegion : null,
  row: isRecord(payload) && isRecord(payload.notice) ? payload.notice : null,
  fetchedAt,
});

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
    const overBudget = () => now().getTime() - startedAt > SYNC_RUN_TIME_BUDGET_MS;
    const summary = emptySummaryOf(runId);
    try {
      const { candidates, listSucceeded, listFailures } = await this.collect(options, summary);
      if (listSucceeded === 0 && listFailures > 0) {
        summary.status = SyncStatus.FAILED;
        await finishRun(this.deps, summary, '목록 조회가 모두 실패했다');
        return summary;
      }
      const collectable = await this.classify(candidates, summary);
      const previous = await this.previousFetches(collectable);
      this.pinRegions(collectable, previous);
      const changed = options.full ? collectable : await this.selectChanged(collectable, previous, summary);
      log(`목록 ${summary.listed}건 — 받을 공고 ${changed.length}건, 바뀌지 않아 건너뜀 ${summary.skipped}건`);
      summary.deferred = await processInPool(
        changed,
        { concurrency: LH_SYNC_CONCURRENCY, overBudget, log },
        (candidate) => this.process(candidate, summary),
      );
      // 새로 만든 단지의 사진도 이번 실행에서 바꾸도록 공고를 모두 저장한 뒤에 돈다
      await lhImageStep(this.deps, this.deps.lh, summary, overBudget);
      await geocodeStep(this.deps, SOURCE, summary, overBudget);
      summary.status = statusOf(summary, listFailures);
      await finishRun(
        this.deps,
        summary,
        summary.deferred > 0 ? `시간 한도로 공고 ${summary.deferred}건을 다음 실행에 넘겼다` : null,
      );
      return summary;
    } catch (error) {
      summary.status = SyncStatus.FAILED;
      await finishRun(this.deps, summary, messageOf(error));
      throw error;
    }
  }

  /** 조합(지역×유형)마다 쪽을 끝까지 받는다. 조합의 기록은 모든 쪽을 받은 뒤에 닫는다 — 2쪽 이후 실패도 같은 행에 쌓이게 */
  private async collect(options: LhSyncOptions, summary: LhSyncSummary) {
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
          await recorder.record(summary.runId, SOURCE, listKey, SyncLevel.ERROR, warning);
          continue;
        }
        const stillOpen: NormalizationWarning[] = [];
        if (!lastPageSeen) {
          const warning = {
            stage: SyncStage.FETCH,
            code: 'LIST_PAGE_LIMIT',
            message: `목록이 ${LH_MAX_LIST_PAGES}쪽을 넘어 나머지를 받지 않았다`,
          };
          await recorder.record(summary.runId, SOURCE, listKey, SyncLevel.WARNING, warning);
          stillOpen.push(warning);
        }
        await recorder.resolveExcept(SOURCE, listKey, stillOpen);
      }
    }
    summary.listed = byKey.size;
    return { candidates: [...byKey.values()], listSucceeded, listFailures };
  }

  /** 수집 범위 밖(전세임대 등)·모르는 유형은 목록 행만으로 가려 상세·공급정보를 부르지 않는다 */
  private async classify(candidates: Candidate[], summary: LhSyncSummary): Promise<Candidate[]> {
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
      await recorder.record(summary.runId, SOURCE, key, SyncLevel.WARNING, warning, {
        queryRegion: region,
        notice: row,
      });
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
    const refreshBefore = this.deps.now().getTime() - SYNC_REFRESH_ACTIVE_MS;
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

  private async process({ key, row, region }: Candidate, summary: LhSyncSummary): Promise<void> {
    const { lh, recorder } = this.deps;
    let bundle: LhNoticeBundle;
    try {
      bundle = await lh.bundleOf(row, region);
    } catch (error) {
      if (!(error instanceof LhApiError)) throw error;
      summary.failed += 1;
      const warning = { stage: SyncStage.FETCH, code: error.code, message: error.message };
      await recorder.record(summary.runId, SOURCE, key, SyncLevel.ERROR, warning, { queryRegion: region, notice: row });
      return;
    }
    summary.fetched += 1;
    await normalizeAndSave(
      this.deps,
      SOURCE,
      summary,
      key,
      bundle,
      () => normalizeLhNotice(bundle),
      async (excluded) => {
        const noListing = { stage: SyncStage.NORMALIZE, code: NO_LISTING_IN_REGION, message: excluded.reason };
        await recorder.record(summary.runId, SOURCE, key, SyncLevel.WARNING, noListing, {
          queryRegion: region,
          notice: row,
        });
        await recordWarnings(this.deps, SOURCE, summary, key, excluded.warnings, [noListing]);
      },
    );
  }
}
