import type { Prisma, PrismaClient } from '@/database/generated/client.js';
import { NEWLYWED_TITLE, NoticeOrigin, PRIMARY_SOURCE_RANK, SyncStage, type NoticeSourceName } from '../constants.js';
import { complexLockKeysOf, resolveComplex } from './complex-resolver.js';
import { dateOf, lockKeys } from './db-values.js';
import { jsonValueOf } from './json-value.js';
import type { NormalizationWarning, NormalizedNotice, Warn } from './normalized-notice.js';
import { noticeSiteKeysOf, sharesSite } from './site-keys.js';
import { mergeByComplex, writeSubscriptions, type ResolvedListing } from './subscription-writer.js';
import { mergeWarnings } from './warnings.js';

/**
 * 매입임대 공고는 건물이 100곳을 넘어 칸마다 쓰는 데 수 초가 걸린다 — 기본 5초로는 큰 공고가 끊긴다.
 * 다른 트랜잭션의 키 잠금을 기다리는 시간도 이 안에 든다(Prisma의 maxWait는 트랜잭션을 여는 데까지만 센다)
 */
const WRITE_TIMEOUT_MS = 60_000;
/** 키 잠금을 이보다 오래 기다리면 DB가 멈추게 한다 — 남은 시간으로 저장을 끝낼 수 있게 timeout의 절반 */
const LOCK_TIMEOUT = '30s';
/** 동시에 도는 수집이 연결 풀을 기다리는 시간(기본 2초) */
const WRITE_MAX_WAIT_MS = 10_000;

export interface WriteResult {
  noticeId: string;
  createdNotice: boolean;
  /** 이 원천이 공고 값을 정했는지. 아니면 원천 참조만 더했다(정정본보다 늦게 받은 원 공고 등) */
  primary: boolean;
  subscriptionIds: string[];
  warnings: NormalizationWarning[];
}

interface SourceRank {
  source: string;
  sourceKey: string;
  correctionMarks: number;
}

const isNoticeSourceName = (value: string): value is NoticeSourceName => Object.hasOwn(PRIMARY_SOURCE_RANK, value);

const rankOf = (source: string): number =>
  isNoticeSourceName(source) ? PRIMARY_SOURCE_RANK[source] : Number.POSITIVE_INFINITY;

/** 공고 값을 정할 원천인지(ERD §5 규칙 7·12) — 기관 원천이 먼저, 같으면 정정 표시가 많은 쪽, 같으면 원천 키가 큰(나중) 쪽 */
const outranks = (candidate: SourceRank, current: SourceRank): boolean => {
  if (rankOf(candidate.source) !== rankOf(current.source)) return rankOf(candidate.source) < rankOf(current.source);
  if (candidate.correctionMarks !== current.correctionMarks) return candidate.correctionMarks > current.correctionMarks;
  return candidate.sourceKey > current.sourceKey;
};

const noticeValuesOf = (notice: NormalizedNotice, fetchedAt: Date) => ({
  title: notice.title,
  titleKey: notice.titleKey,
  supplyCategory: notice.supplyCategory,
  supplyType: notice.supplyType,
  postDate: dateOf(notice.postDate),
  applyUrl: notice.applyUrl,
  attachments: notice.attachments.map(({ name, url, kind }) => ({ name, url, kind })),
  sourceStatus: notice.sourceStatus,
  syncedAt: fetchedAt,
});

const siteKeysOfNotice = (notice: NormalizedNotice) =>
  noticeSiteKeysOf(
    notice.title,
    notice.listings.map((listing) => listing.complex),
  );

/**
 * 이 공고를 저장하며 만들거나 고칠 수 있는 공고·원천·단지 키. 원천이 다른 같은 공고(규칙 19)는 이름이 달라 정정 묶음 키로는
 * 겹치지 않아, 기관·게시일·지구·블록 키로 두 원천의 수집이 같은 공고를 따로 만들지 않게 한다 — 같은 날 공고 전체가 아니라
 * 현장이 겹치는 공고끼리만 기다린다
 */
const lockKeysOf = (notice: NormalizedNotice): string[] => [
  `notice-source:${notice.source}:${notice.sourceKey}`,
  `notice-group:${notice.agencyCode}:${notice.titleKey}:${notice.postDate ?? ''}`,
  ...(notice.postDate === null
    ? []
    : [...siteKeysOfNotice(notice).all].map((key) => `notice-site:${notice.agencyCode}:${notice.postDate}:${key}`)),
  ...notice.listings.flatMap((listing) =>
    listing.complex === null
      ? []
      : complexLockKeysOf(listing.complex, {
          source: notice.source,
          agencyCode: notice.agencyCode,
          regionCode: listing.regionCode,
        }),
  ),
];

/**
 * 다른 원천에 이미 있는 같은 공고(ERD §5 규칙 19). LH와 청약홈은 같은 공고를 이름을 달리해 올리고 공통 키가 없다 — 기관·게시일·
 * 분류·신혼희망 여부가 같고 지구·블록이 겹치는 수집 공고가 하나뿐이면 그 공고다. 같은 날·같은 블록에 공공분양과 신혼희망타운
 * (과천주암 C1), 공공분양과 6년 공공임대(구리갈매 A-4)가 따로 올라와 분류·신혼희망 여부도 본다. 이 원천이 이미 붙은 공고와도
 * 겹치면 이 원천의 다른 공고가 먼저 이어진 것이라, 받는 순서에 따라 엉뚱한 쪽이 차지하지 않게 잇지 않는다
 */
const findAcrossSources = async (
  tx: Prisma.TransactionClient,
  notice: NormalizedNotice,
  warn: Warn,
): Promise<string | null> => {
  const keys = siteKeysOfNotice(notice);
  if (keys.all.size === 0 || notice.postDate === null) return null;
  const candidates = await tx.notice.findMany({
    where: {
      agencyCode: notice.agencyCode,
      postDate: dateOf(notice.postDate),
      supplyCategory: notice.supplyCategory,
      origin: NoticeOrigin.SYNC,
      // 같은 원천끼리는 잇지 않는다(그것은 규칙 7 정정 묶음의 일이다) — 다른 원천이 붙은 공고만 본다
      sources: { some: { source: { not: notice.source } } },
    },
    select: {
      id: true,
      title: true,
      sources: { where: { source: notice.source }, select: { sourceKey: true } },
      subscriptions: { select: { complex: { select: { name: true, address: true } } } },
    },
  });
  const newlywed = NEWLYWED_TITLE.test(notice.title);
  const matches = candidates.filter(
    (candidate) =>
      NEWLYWED_TITLE.test(candidate.title) === newlywed &&
      sharesSite(
        keys,
        noticeSiteKeysOf(
          candidate.title,
          candidate.subscriptions.map((subscription) => subscription.complex),
        ),
      ),
  );
  const free = matches.filter((candidate) => candidate.sources.length === 0);
  const taken = matches.filter((candidate) => candidate.sources.length > 0);
  if (free.length === 1 && taken.length === 0) return free[0].id;
  if (free.length > 1) {
    warn(
      SyncStage.MATCH,
      'CROSS_SOURCE_AMBIGUOUS',
      `다른 원천의 같은 공고 후보가 ${free.length}건이라 새 공고로 두었다`,
    );
  } else if (taken.length > 0) {
    const takenBy = taken.flatMap((candidate) => candidate.sources.map((source) => source.sourceKey)).join(', ');
    warn(
      SyncStage.MATCH,
      'CROSS_SOURCE_TAKEN',
      `같은 현장의 다른 원천 공고에 이 원천의 다른 공고(${takenBy})가 이미 이어져 새 공고로 두었다`,
    );
  }
  return null;
};

/**
 * 이 원천 참조가 이미 있으면 그 공고, 없으면 정정 묶음(기관·정정 표시를 뗀 이름·게시일이 같은 수집 공고, ERD §5 규칙 7)에 더한다.
 * 정정 묶음 후보도 없으면 다른 원천의 같은 공고(규칙 19)에 더한다.
 * 묶음에 같은 원천의 같은 정정 단계가 이미 있으면 정정본이 아니라 같은 날 같은 이름의 다른 공고라 묶지 않는다 —
 * 묶으면 한쪽이 다른 쪽의 칸을 지운다. 후보가 둘 이상이면 어느 쪽인지 몰라 묶지 않는다
 */
const findNoticeId = async (
  tx: Prisma.TransactionClient,
  notice: NormalizedNotice,
  warn: Warn,
): Promise<string | null> => {
  const source = await tx.noticeSource.findUnique({
    where: { source_sourceKey: { source: notice.source, sourceKey: notice.sourceKey } },
    select: { noticeId: true },
  });
  if (source !== null) return source.noticeId;
  if (notice.postDate === null) return null;
  const candidates = await tx.notice.findMany({
    where: {
      agencyCode: notice.agencyCode,
      titleKey: notice.titleKey,
      postDate: dateOf(notice.postDate),
      origin: NoticeOrigin.SYNC,
    },
    select: { id: true, sources: { where: { source: notice.source }, select: { correctionMarks: true } } },
  });
  if (candidates.length === 0) return findAcrossSources(tx, notice, warn);
  const joinable = candidates.filter(
    (candidate) => !candidate.sources.some((row) => row.correctionMarks === notice.correctionMarks),
  );
  if (joinable.length === 1) return joinable[0].id;
  if (joinable.length > 1) {
    warn(SyncStage.MATCH, 'CORRECTION_AMBIGUOUS', `정정 묶음 후보가 ${joinable.length}건이라 새 공고로 두었다`);
  } else if (candidates.length > 0) {
    warn(
      SyncStage.MATCH,
      'SAME_TITLE_NOT_CORRECTION',
      `같은 날 같은 이름의 공고가 이미 같은 정정 단계(${notice.correctionMarks})로 있어 다른 공고로 두었다`,
    );
  }
  return null;
};

const providesApplicationCounts = (notice: NormalizedNotice): boolean =>
  notice.listings.some(
    (listing) =>
      listing.applicationCount !== undefined || listing.units.some((unit) => unit.applicationCount !== undefined),
  );

/**
 * 신청 인원을 정하는 원천(청약홈)이 보조 원천이면 칸·주택형이 우선 원천 것이라 옮기지 않는다(ERD §5 규칙 12). 실데이터에서는
 * 이런 공고에 청약홈 경쟁률이 없지만, 생기면 알 수 있게 경고로 남긴다
 */
const warnUnappliedApplicationCounts = (notice: NormalizedNotice, warn: Warn) => {
  const total = notice.listings.reduce((sum, listing) => sum + (listing.applicationCount ?? 0), 0);
  if (total > 0) {
    warn(
      SyncStage.MATCH,
      'APPLICATION_COUNT_NOT_APPLIED',
      `우선 원천이 다른 공고라 신청 인원(${total}명)을 칸에 옮기지 않았다`,
    );
  }
};

/** 정규화한 공고 한 건을 저장한다. 한 트랜잭션이라 중간에 실패하면 이 공고는 이전 상태 그대로 남는다 */
export class NoticeWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async write(notice: NormalizedNotice, raw: unknown, fetchedAt: Date): Promise<WriteResult> {
    const rawPayload = jsonValueOf(raw);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        await lockKeys(tx, lockKeysOf(notice));
        return this.writeIn(tx, notice, rawPayload, fetchedAt);
      },
      { timeout: WRITE_TIMEOUT_MS, maxWait: WRITE_MAX_WAIT_MS },
    );
  }

  private async writeIn(
    tx: Prisma.TransactionClient,
    notice: NormalizedNotice,
    rawPayload: Prisma.InputJsonValue,
    fetchedAt: Date,
  ): Promise<WriteResult> {
    const warnings: NormalizationWarning[] = [];
    const warn: Warn = (stage, code, message) => warnings.push({ stage, code, message });
    const sourceKey = { source: notice.source, sourceKey: notice.sourceKey };
    const sourceValues = {
      sourceParams: notice.sourceParams,
      rawPayload,
      fetchedAt,
      correctionMarks: notice.correctionMarks,
    };
    const resultOf = (noticeId: string, createdNotice: boolean, subscriptionIds: string[] | null): WriteResult => ({
      noticeId,
      createdNotice,
      primary: subscriptionIds !== null,
      subscriptionIds: subscriptionIds ?? [],
      warnings: mergeWarnings(warnings),
    });

    const foundId = await findNoticeId(tx, notice, warn);
    if (foundId === null) {
      const created = await tx.notice.create({
        data: { agencyCode: notice.agencyCode, origin: NoticeOrigin.SYNC, ...noticeValuesOf(notice, fetchedAt) },
        select: { id: true },
      });
      await tx.noticeSource.create({ data: { ...sourceKey, ...sourceValues, noticeId: created.id, isPrimary: true } });
      return resultOf(created.id, true, await this.writeListings(tx, created.id, notice, warn));
    }

    const currentPrimary = await tx.noticeSource.findFirst({
      where: { noticeId: foundId, isPrimary: true },
      select: { source: true, sourceKey: true, correctionMarks: true },
    });
    await tx.noticeSource.upsert({
      where: { source_sourceKey: sourceKey },
      create: { ...sourceKey, ...sourceValues, noticeId: foundId, isPrimary: false },
      update: sourceValues,
    });
    const isCurrentPrimary =
      currentPrimary !== null &&
      currentPrimary.source === notice.source &&
      currentPrimary.sourceKey === notice.sourceKey;
    const takesOver =
      currentPrimary === null || isCurrentPrimary || outranks({ ...sourceKey, ...sourceValues }, currentPrimary);
    if (!takesOver) {
      warnUnappliedApplicationCounts(notice, warn);
      return resultOf(foundId, false, null);
    }

    // 공고마다 우선 원천은 하나(부분 UNIQUE) — 다른 원천을 먼저 내린 뒤 올린다
    await tx.noticeSource.updateMany({ where: { noticeId: foundId, isPrimary: true }, data: { isPrimary: false } });
    await tx.noticeSource.update({ where: { source_sourceKey: sourceKey }, data: { isPrimary: true } });
    await tx.notice.update({ where: { id: foundId }, data: noticeValuesOf(notice, fetchedAt) });
    const subscriptionIds = await this.writeListings(tx, foundId, notice, warn);
    const tookOverFromAnotherSource = currentPrimary !== null && currentPrimary.source !== notice.source;
    if (tookOverFromAnotherSource && !providesApplicationCounts(notice)) {
      // 칸·주택형이 새 우선 원천 것으로 바뀌어, 전 원천이 센 신청 인원을 두면 공급 세대와 범위가 어긋난 경쟁률이 된다
      await tx.subscription.updateMany({ where: { noticeId: foundId }, data: { applicationCount: null } });
      await tx.subscriptionUnit.updateMany({
        where: { subscription: { noticeId: foundId } },
        data: { applicationCount: null },
      });
    }
    return resultOf(foundId, false, subscriptionIds);
  }

  private async writeListings(
    tx: Prisma.TransactionClient,
    noticeId: string,
    notice: NormalizedNotice,
    warn: Warn,
  ): Promise<string[]> {
    const resolved: ResolvedListing[] = [];
    for (const listing of notice.listings) {
      if (listing.complex === null) {
        resolved.push({ complexId: null, complexMatch: null, listing });
        continue;
      }
      const complex = await resolveComplex(
        tx,
        listing.complex,
        { source: notice.source, agencyCode: notice.agencyCode, regionCode: listing.regionCode },
        warn,
      );
      resolved.push({ ...complex, listing });
    }
    return writeSubscriptions(tx, noticeId, mergeByComplex(resolved, warn));
  }
}
