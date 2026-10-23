import { Injectable } from '@nestjs/common';
import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import { PrismaService } from '@/database/prisma.service.js';
import { Prisma } from '@/database/generated/client.js';
import { SIZE_RANGES, type SizeRange, type SubscriptionSort } from './constants.js';
import type { GeoBounds } from './list-rules.js';

// 주택형 순서는 숫자로 매겨야 해서 매퍼가 정렬한다
const DETAIL_INCLUDE = {
  units: true,
  // 첫째가 상세가 처음 보여 줄 도면이다. 순서 값이 같으면 id로 갈라 매번 같은 도면이 첫째가 되게 한다
  floorplans: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SubscriptionInclude;

const LIST_INCLUDE = {
  floorplans: { select: { exclusiveArea: true } },
} satisfies Prisma.SubscriptionInclude;

/** 검색 순위에 필요한 열만 — 검색어에 맞는 공고 전체를 읽는 단계라 도면·긴 글자는 싣지 않는다 */
const SEARCH_SELECT = {
  id: true,
  title: true,
  applyStartDate: true,
  applyEndDate: true,
  cancelledAt: true,
} satisfies Prisma.SubscriptionSelect;

const MARKER_SELECT = {
  id: true,
  title: true,
  lat: true,
  lng: true,
  agencyCode: true,
  applyStartDate: true,
  applyEndDate: true,
  cancelledAt: true,
} satisfies Prisma.SubscriptionSelect;

export type SubscriptionDetailRecord = Prisma.SubscriptionGetPayload<{ include: typeof DETAIL_INCLUDE }>;
export type SubscriptionListRecord = Prisma.SubscriptionGetPayload<{ include: typeof LIST_INCLUDE }>;
export type SubscriptionSearchRow = Prisma.SubscriptionGetPayload<{ select: typeof SEARCH_SELECT }>;
export type SubscriptionMarkerRow = Prisma.SubscriptionGetPayload<{ select: typeof MARKER_SELECT }>;

export interface SubscriptionListFilter {
  regionCode?: number;
  agencyCode?: number;
  sizeRange?: SizeRange;
  keyword?: { text: string; agencyCodes: number[]; regionCodes: number[] };
  bounds?: GeoBounds;
  /** 오늘(한국 날짜 YYYY-MM-DD) 기준 상태 */
  status?: { code: SubscriptionStatusCode; today: string };
}

export interface SubscriptionPageRequest {
  sort: SubscriptionSort;
  /** 마감 임박순의 D-day를 세는 오늘(한국 날짜 YYYY-MM-DD) */
  today: string;
  offset: number;
  limit: number;
}

// 평면도가 한 장도 없는 공고는 올리지 않는다 — 집보다는 도면으로 집을 보여 주는 서비스라 눌러도 볼 것이 없다
const LISTED: Prisma.SubscriptionWhereInput = { floorplans: { some: {} } };

const STORED_STATUS_CODES = [
  SubscriptionStatusCode.UPCOMING,
  SubscriptionStatusCode.OPEN,
  SubscriptionStatusCode.CLOSED,
  SubscriptionStatusCode.CANCELLED,
] as const;

// Prisma의 contains는 %·_를 LIKE 와일드카드로 그대로 넘긴다 — '%'로 찾으면 전부가 나오지 않게 글자로 바꿔 둔다
const escapeLikePattern = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const textContains = (text: string) => ({ contains: escapeLikePattern(text), mode: 'insensitive' as const });

const areaBetween = (range: SizeRange): Prisma.DecimalNullableFilter =>
  range.max === null ? { gte: range.min } : { gte: range.min, lt: range.max };

/**
 * 같은 상태 규칙이 세 곳에 있다 — 응답 계산(schedule.ts statusCodeOf), Prisma 조건(statusWhere), 목록 SQL(statusSql).
 * 하나를 바꾸면 셋을 함께 바꾼다(e2e "상태 규칙" 테스트가 날짜 경계마다 맞춰 본다).
 * 일정이 없는 공고는 어떤 상태에도 들지 않는다
 */
const statusWhere = (code: SubscriptionStatusCode, today: string): Prisma.SubscriptionWhereInput => {
  const day = new Date(`${today}T00:00:00Z`);
  switch (code) {
    case SubscriptionStatusCode.UPCOMING:
      return { cancelledAt: null, applyStartDate: { gt: day }, applyEndDate: { not: null } };
    case SubscriptionStatusCode.OPEN:
      return { cancelledAt: null, applyStartDate: { lte: day }, applyEndDate: { gte: day } };
    case SubscriptionStatusCode.CLOSED:
      return { cancelledAt: null, applyStartDate: { lte: day }, applyEndDate: { lt: day } };
    case SubscriptionStatusCode.CANCELLED:
      return { cancelledAt: { not: null } };
    case SubscriptionStatusCode.ALL:
      return {};
  }
};

const statusSql = (code: SubscriptionStatusCode, today: string): Prisma.Sql => {
  const day = Prisma.sql`${today}::date`;
  switch (code) {
    case SubscriptionStatusCode.UPCOMING:
      return Prisma.sql`s.cancelled_at IS NULL AND s.apply_start_date > ${day} AND s.apply_end_date IS NOT NULL`;
    case SubscriptionStatusCode.OPEN:
      return Prisma.sql`s.cancelled_at IS NULL AND s.apply_start_date <= ${day} AND s.apply_end_date >= ${day}`;
    case SubscriptionStatusCode.CLOSED:
      return Prisma.sql`s.cancelled_at IS NULL AND s.apply_start_date <= ${day} AND s.apply_end_date < ${day}`;
    case SubscriptionStatusCode.CANCELLED:
      return Prisma.sql`s.cancelled_at IS NOT NULL`;
    case SubscriptionStatusCode.ALL:
      return Prisma.sql`TRUE`;
  }
};

const whereOf = (filter: SubscriptionListFilter): Prisma.SubscriptionWhereInput => {
  const { regionCode, agencyCode, sizeRange, keyword, bounds, status } = filter;
  const conditions: Prisma.SubscriptionWhereInput[] = [LISTED];
  if (regionCode !== undefined) conditions.push({ regionCode });
  if (agencyCode !== undefined) conditions.push({ agencyCode });
  if (sizeRange) conditions.push({ floorplans: { some: { exclusiveArea: areaBetween(sizeRange) } } });
  if (keyword) {
    conditions.push({
      OR: [
        { title: textContains(keyword.text) },
        { address: textContains(keyword.text) },
        { supplyType: textContains(keyword.text) },
        { agencyCode: { in: keyword.agencyCodes } },
        { regionCode: { in: keyword.regionCodes } },
      ],
    });
  }
  if (bounds) {
    conditions.push({ lat: { gte: bounds.south, lte: bounds.north }, lng: { gte: bounds.west, lte: bounds.east } });
  }
  if (status) conditions.push(statusWhere(status.code, status.today));
  return { AND: conditions };
};

/**
 * whereOf와 같은 조건의 SQL. 목록은 계산 값(D-day·경쟁률)으로 정렬한 뒤 DB에서 페이지를 나눠야 해서
 * Prisma 조건을 쓸 수 없다 — 조건을 바꾸면 두 곳을 함께 바꾼다(e2e 목록 조건 테스트가 건수로 SQL 쪽을 본다)
 */
const whereSql = (filter: SubscriptionListFilter): Prisma.Sql => {
  const { regionCode, agencyCode, sizeRange, keyword, bounds, status } = filter;
  const conditions = [Prisma.sql`EXISTS (SELECT 1 FROM floorplans f WHERE f.subscription_id = s.id)`];
  if (regionCode !== undefined) conditions.push(Prisma.sql`s.region_code = ${regionCode}`);
  if (agencyCode !== undefined) conditions.push(Prisma.sql`s.agency_code = ${agencyCode}`);
  if (sizeRange) {
    const below = sizeRange.max === null ? Prisma.empty : Prisma.sql`AND f.exclusive_area < ${sizeRange.max}::numeric`;
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM floorplans f WHERE f.subscription_id = s.id AND f.exclusive_area >= ${sizeRange.min}::numeric ${below})`,
    );
  }
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword.text)}%`;
    const matches = [
      Prisma.sql`s.title ILIKE ${pattern}`,
      Prisma.sql`s.address ILIKE ${pattern}`,
      Prisma.sql`s.supply_type ILIKE ${pattern}`,
    ];
    if (keyword.agencyCodes.length > 0)
      matches.push(Prisma.sql`s.agency_code IN (${Prisma.join(keyword.agencyCodes)})`);
    if (keyword.regionCodes.length > 0)
      matches.push(Prisma.sql`s.region_code IN (${Prisma.join(keyword.regionCodes)})`);
    conditions.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
  }
  if (bounds) {
    conditions.push(
      Prisma.sql`s.lat BETWEEN ${bounds.south} AND ${bounds.north} AND s.lng BETWEEN ${bounds.west} AND ${bounds.east}`,
    );
  }
  if (status) conditions.push(statusSql(status.code, status.today));
  return Prisma.join(conditions, ' AND ');
};

/** web 목록과 같은 정렬. D-day는 접수 중인 공고만 있다(ddayOf), 경쟁률은 공급 호수를 모르면 없다(competitionRatioOf) */
const ORDER_BY: Record<SubscriptionSort, (today: string) => Prisma.Sql> = {
  DEADLINE: (today) =>
    Prisma.sql`CASE WHEN ${statusSql(SubscriptionStatusCode.OPEN, today)} THEN s.apply_end_date - ${today}::date END ASC NULLS LAST`,
  COMPETITION: () =>
    Prisma.sql`CASE WHEN s.application_count IS NOT NULL AND s.supply_units > 0 THEN s.application_count::float8 / s.supply_units END ASC NULLS LAST`,
  HOUSEHOLDS: () => Prisma.sql`s.households DESC NULLS LAST`,
};

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetailById(id: string): Promise<SubscriptionDetailRecord | null> {
    return this.prisma.subscription.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  /**
   * 정렬·페이지 나누기·건수까지 DB가 한다 — 조건에 맞는 공고를 모두 읽어 서버에서 정렬하면 건수에 비례해 느려진다.
   * 값이 같으면 id를 코드 포인트 순("C" = UTF-8 바이트 순)으로 가른다. DB 기본 정렬 규칙(locale)을 따르면
   * 기호를 건너뛰어 배포 환경마다 순서가 달라질 수 있다
   */
  async findPage(
    filter: SubscriptionListFilter,
    { sort, today, offset, limit }: SubscriptionPageRequest,
  ): Promise<{ ids: string[]; totalCount: number }> {
    const where = whereSql(filter);
    // 건수를 같은 쿼리에서 세야 페이지와 건수가 한 시점의 결과다. 마지막 페이지를 넘으면 행이 없어 따로 센다
    const rows = await this.prisma.$queryRaw<{ id: string; total: number }[]>`
      SELECT s.id, (count(*) OVER ())::int AS total FROM subscriptions s
      WHERE ${where}
      ORDER BY ${ORDER_BY[sort](today)}, s.id COLLATE "C"
      LIMIT ${limit} OFFSET ${offset}`;
    if (rows.length > 0) return { ids: rows.map((row) => row.id), totalCount: rows[0].total };
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM subscriptions s WHERE ${where}`;
    return { ids: [], totalCount: total };
  }

  findSearchRows(filter: SubscriptionListFilter): Promise<SubscriptionSearchRow[]> {
    return this.prisma.subscription.findMany({ where: whereOf(filter), select: SEARCH_SELECT });
  }

  /** 두 번 읽는 사이에 공고가 바뀌어 조건에서 벗어났으면 빠지도록 같은 조건을 다시 건다 */
  findListedByIds(ids: string[], filter: SubscriptionListFilter): Promise<SubscriptionListRecord[]> {
    return this.prisma.subscription.findMany({
      where: { AND: [whereOf(filter), { id: { in: ids } }] },
      include: LIST_INCLUDE,
    });
  }

  findMarkerRows(filter: SubscriptionListFilter): Promise<SubscriptionMarkerRow[]> {
    return this.prisma.subscription.findMany({
      where: { AND: [whereOf(filter), { lat: { not: null }, lng: { not: null } }] },
      select: MARKER_SELECT,
      orderBy: { id: 'asc' },
    });
  }

  /**
   * 필터 선택지에 쓸 값. Prisma의 distinct는 SQL이 아니라 받아 온 뒤 메모리에서 걸러 전부를 실어 오므로,
   * 지역·기관은 groupBy(SQL GROUP BY)로, 상태·면적 구간은 해당하는 행이 한 건이라도 있는지만 묻는다.
   * 도면은 모두 도면이 있는 공고에 딸려 있어 면적에는 목록 조건(LISTED)을 따로 걸 필요가 없다
   */
  async findFilterOptionSources(today: string) {
    const [regions, agencies, statusHits, sizeHits] = await Promise.all([
      this.prisma.subscription.groupBy({ by: ['regionCode'], where: LISTED, orderBy: { regionCode: 'asc' } }),
      this.prisma.subscription.groupBy({ by: ['agencyCode'], where: LISTED, orderBy: { agencyCode: 'asc' } }),
      Promise.all(
        STORED_STATUS_CODES.map((code) =>
          this.prisma.subscription.findFirst({
            where: { AND: [LISTED, statusWhere(code, today)] },
            select: { id: true },
          }),
        ),
      ),
      Promise.all(
        SIZE_RANGES.map((range) =>
          this.prisma.floorplan.findFirst({ where: { exclusiveArea: areaBetween(range) }, select: { id: true } }),
        ),
      ),
    ]);
    return {
      regionCodes: regions.map((row) => row.regionCode),
      agencyCodes: agencies.map((row) => row.agencyCode),
      statusCodes: STORED_STATUS_CODES.filter((_code, index) => statusHits[index] !== null),
      sizeRanges: SIZE_RANGES.filter((_range, index) => sizeHits[index] !== null),
    };
  }
}
