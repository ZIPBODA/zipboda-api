import {
  NoticeSourceName,
  SYNC_REFRESH_ACTIVE_MS,
  SYNC_RUN_TIME_BUDGET_MS,
  SyncLevel,
  SyncStage,
  SyncStatus,
} from '../../constants.js';
import { serviceDateOf } from '../../schedule.js';
import type { NormalizationWarning } from '../normalized-notice.js';
import { parseDate } from '../normalize-text.js';
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
import { ApplyhomeApiError, type ApplyhomeListQuery } from './applyhome-api.client.js';
import { classifyApplyhomeNotice } from './applyhome-classify.js';
import { normalizeApplyhomeNotice } from './applyhome-normalizer.js';
import {
  APPLYHOME_MAX_LIST_PAGES,
  APPLYHOME_PAGE_SIZE,
  APPLYHOME_PROGRESS_DATE_FIELD,
  APPLYHOME_SYNC_CONCURRENCY,
  ApplyhomeKind,
} from './applyhome.constants.js';
import type { ApplyhomeBundle, ApplyhomeRow } from './applyhome-raw.js';

const SOURCE = NoticeSourceName.APPLYHOME;

/** 수집기가 쓰는 청약홈 API — 테스트는 저장해 둔 실제 응답으로 바꿔 끼운다 */
export interface ApplyhomeSource {
  listNotices(query: ApplyhomeListQuery): Promise<ApplyhomeRow[]>;
  bundleOf(kind: ApplyhomeKind, detail: ApplyhomeRow): Promise<ApplyhomeBundle>;
}

export interface ApplyhomeSyncDependencies extends SyncDependencies {
  applyhome: ApplyhomeSource;
}

interface Candidate {
  key: string;
  kind: ApplyhomeKind;
  detail: ApplyhomeRow;
}

/** 지난번에 받은 상세 행·받은 때(저장한 원천 응답에서 읽는다) */
interface PreviousFetch {
  detail: Record<string, unknown> | null;
  fetchedAt: Date | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sourceKeyOf = (detail: ApplyhomeRow): string => `${detail.HOUSE_MANAGE_NO ?? ''}:${detail.PBLANC_NO ?? ''}`;

/** 목록이 곧 상세라 행 전체를 비교한다 — 열 순서가 바뀌어도 같게 */
const detailFingerprintOf = (detail: Record<string, unknown>): string =>
  JSON.stringify(Object.entries(detail).sort(([a], [b]) => (a < b ? -1 : 1)));

/** 접수·당첨자 발표·계약 중 가장 늦은 날짜. 하나도 읽지 못하면 null */
const lastProgressDateOf = (detail: ApplyhomeRow): string | null =>
  Object.entries(detail)
    .filter(([name]) => APPLYHOME_PROGRESS_DATE_FIELD.test(name))
    .map(([, value]) => parseDate(value))
    .filter((date) => date !== null)
    .sort()
    .at(-1) ?? null;

/**
 * 청약홈 공고 수집 한 번(API-114, ERD §5 규칙 17·18). 다섯 갈래 목록을 모집공고일 범위로 받아 사업주체·지역·분류로 거르고(민간
 * 분양이 대부분이라 주택형·경쟁률을 부르기 전에 거른다), 바뀐 공고만 주택형·경쟁률을 받아 정규화해 저장한다. LH에도 있는 공고는
 * 저장 단계가 LH 공고에 잇는다(규칙 19) — LH 수집을 먼저 돌리면 대부분 참조만 더한다
 */
export class ApplyhomeSyncRunner {
  constructor(private readonly deps: ApplyhomeSyncDependencies) {}

  async run(options: SyncOptions): Promise<SyncSummary> {
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
      const changed = options.full ? collectable : await this.selectChanged(collectable, summary);
      log(`목록 ${summary.listed}건 — 받을 공고 ${changed.length}건, 바뀌지 않아 건너뜀 ${summary.skipped}건`);
      summary.deferred = await processInPool(
        changed,
        { concurrency: APPLYHOME_SYNC_CONCURRENCY, overBudget, log },
        (candidate) => this.process(candidate, summary),
      );
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

  /** 갈래마다 쪽을 끝까지 받는다. 갈래의 기록은 모든 쪽을 받은 뒤에 닫는다 — 2쪽 이후 실패도 같은 행에 쌓이게 */
  private async collect(options: SyncOptions, summary: SyncSummary) {
    const { applyhome, recorder } = this.deps;
    const byKey = new Map<string, Candidate>();
    let listSucceeded = 0;
    let listFailures = 0;
    for (const kind of Object.values(ApplyhomeKind)) {
      const listKey = `list:${kind}`;
      let failure: ApplyhomeApiError | null = null;
      let lastPageSeen = false;
      for (let page = 1; page <= APPLYHOME_MAX_LIST_PAGES && !lastPageSeen; page += 1) {
        let rows: ApplyhomeRow[];
        try {
          rows = await applyhome.listNotices({ kind, from: options.from, to: options.to, page });
        } catch (error) {
          if (!(error instanceof ApplyhomeApiError)) throw error;
          failure = error;
          break;
        }
        listSucceeded += 1;
        for (const detail of rows) {
          const key = sourceKeyOf(detail);
          if (!byKey.has(key)) byKey.set(key, { key, kind, detail });
        }
        lastPageSeen = rows.length < APPLYHOME_PAGE_SIZE;
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
          message: `목록이 ${APPLYHOME_MAX_LIST_PAGES}쪽을 넘어 나머지를 받지 않았다`,
        };
        await recorder.record(summary.runId, SOURCE, listKey, SyncLevel.WARNING, warning);
        stillOpen.push(warning);
      }
      await recorder.resolveExcept(SOURCE, listKey, stillOpen);
    }
    summary.listed = byKey.size;
    return { candidates: [...byKey.values()], listSucceeded, listFailures };
  }

  /** 사업주체·지역·분류로 거른다(규칙 18) — 상세 행만 보므로 주택형·경쟁률을 부르지 않는다 */
  private async classify(candidates: Candidate[], summary: SyncSummary): Promise<Candidate[]> {
    const { recorder } = this.deps;
    const collectable: Candidate[] = [];
    const excludedKeys: string[] = [];
    for (const candidate of candidates) {
      const { key, kind, detail } = candidate;
      const classification = classifyApplyhomeNotice(kind, detail);
      if (classification.kind === 'collect') {
        collectable.push(candidate);
        continue;
      }
      if (classification.kind === 'exclude') {
        summary.excluded += 1;
        if (classification.warnings.length === 0) {
          excludedKeys.push(key);
          continue;
        }
        for (const warning of classification.warnings) {
          await recorder.record(summary.runId, SOURCE, key, SyncLevel.WARNING, warning, { kind, detail });
        }
        summary.warnings += classification.warnings.length;
        await recorder.resolveExcept(SOURCE, key, classification.warnings);
        continue;
      }
      summary.unclassified += 1;
      const warning = {
        stage: SyncStage.NORMALIZE,
        code: 'UNCLASSIFIED_TYPE',
        message: `분류표에 없는 청약홈 유형 ${classification.typeKey}`,
      };
      await recorder.record(summary.runId, SOURCE, key, SyncLevel.WARNING, warning, { kind, detail });
      await recorder.resolveExcept(SOURCE, key, [warning]);
    }
    // 지난번에 받다 실패한 공고가 이제 범위 밖이면 다시 받지 않으니 그 기록도 닫는다(민간 분양이 많아 한 번에)
    await recorder.resolveAll(SOURCE, excludedKeys);
    return collectable;
  }

  /**
   * 처음 보는 공고, 상세 행이 바뀐 공고, 아직 진행 중인데(접수·당첨자 발표·계약 중 가장 늦은 날이 오늘 이후) 오래전에 받은
   * 공고(일반공급 경쟁률은 접수가 끝나야 생긴다), 끝났지만 끝나기 전에 받은 공고(한 번 더), 지난 실행에서 저장하지 못한
   * 공고(미해결 ERROR)만 받는다
   */
  private async selectChanged(candidates: Candidate[], summary: SyncSummary): Promise<Candidate[]> {
    const keys = candidates.map((candidate) => candidate.key);
    const [sources, openErrors] = await Promise.all([
      this.deps.prisma.noticeSource.findMany({
        where: { source: SOURCE, sourceKey: { in: keys } },
        select: { sourceKey: true, rawPayload: true, fetchedAt: true },
      }),
      this.deps.prisma.syncFailure.findMany({
        where: { source: SOURCE, sourceKey: { in: keys }, level: SyncLevel.ERROR, resolvedAt: null },
        select: { sourceKey: true },
      }),
    ]);
    const previous = new Map<string, PreviousFetch>(
      sources.map((row) => [
        row.sourceKey,
        {
          detail: isRecord(row.rawPayload) && isRecord(row.rawPayload.detail) ? row.rawPayload.detail : null,
          fetchedAt: row.fetchedAt,
        },
      ]),
    );
    const retryKeys = new Set(openErrors.map((row) => row.sourceKey));
    const today = serviceDateOf(this.deps.now());
    const refreshBefore = this.deps.now().getTime() - SYNC_REFRESH_ACTIVE_MS;
    const changed = candidates.filter(({ key, detail }) => {
      const last = previous.get(key);
      if (last === undefined || retryKeys.has(key)) return true;
      if (last.detail === null || detailFingerprintOf(last.detail) !== detailFingerprintOf(detail)) return true;
      const lastDate = lastProgressDateOf(detail);
      const stale = last.fetchedAt === null || last.fetchedAt.getTime() < refreshBefore;
      if (lastDate === null || today <= lastDate) return stale;
      // 끝난 공고라도 끝나기 전에 받은 것이면 한 번 더 받는다 — 수집이 며칠 멈춘 사이 끝났으면 마지막 경쟁률·일정을 잃지 않게
      return last.fetchedAt === null || serviceDateOf(last.fetchedAt) <= lastDate;
    });
    summary.skipped = candidates.length - changed.length;
    return changed;
  }

  private async process({ key, kind, detail }: Candidate, summary: SyncSummary): Promise<void> {
    const { applyhome, recorder } = this.deps;
    let bundle: ApplyhomeBundle;
    try {
      bundle = await applyhome.bundleOf(kind, detail);
    } catch (error) {
      if (!(error instanceof ApplyhomeApiError)) throw error;
      summary.failed += 1;
      const warning = { stage: SyncStage.FETCH, code: error.code, message: error.message };
      await recorder.record(summary.runId, SOURCE, key, SyncLevel.ERROR, warning, { kind, detail });
      return;
    }
    summary.fetched += 1;
    await normalizeAndSave(
      this.deps,
      SOURCE,
      summary,
      key,
      bundle,
      () => normalizeApplyhomeNotice(bundle),
      (excluded) => recordWarnings(this.deps, SOURCE, summary, key, excluded.warnings),
    );
  }
}
