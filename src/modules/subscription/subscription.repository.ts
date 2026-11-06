import { Injectable } from '@nestjs/common';
import {
  STORED_AGENCY_CODES,
  STORED_REGION_CODES,
  SubscriptionStatusCode,
} from '@/common/constants/interface-codes.js';
import { PrismaService } from '@/database/prisma.service.js';
import { Prisma } from '@/database/generated/client.js';
import { FLOORPLAN_VISIBLE_MATCHES, SIZE_RANGES, type SizeRange, type SubscriptionSort } from './constants.js';
import type { GeoBounds } from './list-rules.js';

const NOTICE_SUMMARY_SELECT = {
  title: true,
  agencyCode: true,
  supplyType: true,
  cancelledAt: true,
} satisfies Prisma.NoticeSelect;

const COMPLEX_SUMMARY_SELECT = {
  name: true,
  sigungu: true,
  address: true,
  lat: true,
  lng: true,
  households: true,
  imageUrl: true,
} satisfies Prisma.ComplexSelect;

// 주택형 순서는 숫자(면적)로 매겨야 해서 매퍼가 정렬한다. 도면은 정해 둔 순서 값이 있어 DB가 정렬한다
const DETAIL_INCLUDE = {
  notice: { select: { ...NOTICE_SUMMARY_SELECT, postDate: true, applyUrl: true } },
  complex: {
    select: {
      ...COMPLEX_SUMMARY_SELECT,
      // 첫째가 상세가 처음 보여 줄 도면이다. 순서 값이 같으면 id로 갈라 매번 같은 도면이 첫째가 되게 한다
      floorplans: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] },
    },
  },
  units: true,
} satisfies Prisma.SubscriptionInclude;

const LIST_INCLUDE = {
  notice: { select: NOTICE_SUMMARY_SELECT },
  complex: { select: { ...COMPLEX_SUMMARY_SELECT, floorplans: { select: { exclusiveArea: true } } } },
  units: { select: { exclusiveArea: true } },
} satisfies Prisma.SubscriptionInclude;

export type SubscriptionDetailRecord = Prisma.SubscriptionGetPayload<{ include: typeof DETAIL_INCLUDE }>;
export type SubscriptionListRecord = Prisma.SubscriptionGetPayload<{ include: typeof LIST_INCLUDE }>;

/** 검색 순위에 필요한 열만 — 검색어에 맞는 칸 전체를 읽는 단계라 도면·긴 글자는 싣지 않는다 */
export interface SubscriptionSearchRow {
  id: string;
  title: string;
  applyStartDate: Date | null;
  applyEndDate: Date | null;
  cancelledAt: Date | null;
}

export interface SubscriptionMarkerRow extends SubscriptionSearchRow {
  lat: number | null;
  lng: number | null;
  agencyCode: number;
}

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

const STORED_STATUS_CODES = [
  SubscriptionStatusCode.UPCOMING,
  SubscriptionStatusCode.OPEN,
  SubscriptionStatusCode.CLOSED,
  SubscriptionStatusCode.CANCELLED,
] as const;

/** 목록 한 칸(s)과 공고(n), 단지(c). 단지 정보가 없는 공고 단위 칸이 있어 단지는 바깥 조인이다 */
const LISTING_FROM = Prisma.sql`subscriptions s JOIN notices n ON n.id = s.notice_id LEFT JOIN complexes c ON c.id = s.complex_id`;

/** 화면에 보이는 이름 — 단지명, 공고 단위 칸은 공고명 */
const DISPLAY_TITLE = Prisma.sql`COALESCE(c.name, n.title)`;

const floorplanVisible = Prisma.sql`s.complex_match IN (${Prisma.join(FLOORPLAN_VISIBLE_MATCHES)})`;

// LIKE의 %·_를 와일드카드가 아니라 글자로 찾게 바꿔 둔다 — '%'로 찾으면 전부가 나오지 않게
const escapeLikePattern = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** 구간은 왼쪽 경계만 포함한다(min ≤ 면적 < max). max가 없으면 상한이 없다 */
const areaInRange = (area: Prisma.Sql, range: SizeRange): Prisma.Sql =>
  range.max === null
    ? Prisma.sql`${area} >= ${range.min}::numeric`
    : Prisma.sql`${area} >= ${range.min}::numeric AND ${area} < ${range.max}::numeric`;

/** 면적 범위 [low, high]가 구간과 겹친다(low < max 그리고 high ≥ min) */
const areaRangeOverlaps = (low: Prisma.Sql, high: Prisma.Sql, range: SizeRange): Prisma.Sql =>
  range.max === null
    ? Prisma.sql`${low} IS NOT NULL AND ${high} >= ${range.min}::numeric`
    : Prisma.sql`${low} < ${range.max}::numeric AND ${high} >= ${range.min}::numeric`;

/**
 * 면적 구간 필터(ERD §5 규칙 11): 주택형 전용면적이 구간 안이거나, 주택형 면적 구간이 겹치거나,
 * 보여 주는 평면도의 전용면적이 구간 안이거나, 주택형 행이 없을 때 단지 면적 범위가 겹치면 든다
 */
const sizeRangeSql = (range: SizeRange): Prisma.Sql => Prisma.sql`(
  EXISTS (SELECT 1 FROM subscription_units u WHERE u.subscription_id = s.id
    AND ((${areaInRange(Prisma.sql`u.exclusive_area`, range)}) OR (${areaRangeOverlaps(Prisma.sql`u.area_min`, Prisma.sql`u.area_max`, range)})))
  OR (${floorplanVisible} AND EXISTS (SELECT 1 FROM floorplans f WHERE f.complex_id = s.complex_id
    AND ${areaInRange(Prisma.sql`f.exclusive_area`, range)}))
  OR (NOT EXISTS (SELECT 1 FROM subscription_units u WHERE u.subscription_id = s.id)
    AND ${areaRangeOverlaps(Prisma.sql`c.area_min`, Prisma.sql`c.area_max`, range)})
)`;

/**
 * sizeRangeSql과 같은 규칙을 '맞는 칸이 하나라도 있는가'로 묻는다. sizeRangeSql을 EXISTS로 감싸면 플래너가 주택형 전체로
 * 해시를 만든 뒤에야 첫 칸을 봐(5만 칸에서 구간마다 약 50ms) 맞는 행에서 바로 멈추는 모양으로 따로 둔다.
 * 규칙을 바꾸면 둘을 함께 바꾼다(e2e '면적 구간 규칙'이 목록과 선택지를 함께 본다)
 */
const sizeRangeListedSql = (range: SizeRange): Prisma.Sql => Prisma.sql`(
  EXISTS (SELECT 1 FROM ${LISTING_FROM} JOIN subscription_units u ON u.subscription_id = s.id
    WHERE (${areaInRange(Prisma.sql`u.exclusive_area`, range)}) OR (${areaRangeOverlaps(Prisma.sql`u.area_min`, Prisma.sql`u.area_max`, range)}))
  OR EXISTS (SELECT 1 FROM ${LISTING_FROM} JOIN floorplans f ON f.complex_id = s.complex_id
    WHERE ${floorplanVisible} AND ${areaInRange(Prisma.sql`f.exclusive_area`, range)})
  OR EXISTS (SELECT 1 FROM ${LISTING_FROM}
    WHERE NOT EXISTS (SELECT 1 FROM subscription_units u WHERE u.subscription_id = s.id)
      AND ${areaRangeOverlaps(Prisma.sql`c.area_min`, Prisma.sql`c.area_max`, range)})
)`;

/**
 * 같은 상태 규칙이 두 곳에 있다 — 응답 계산(schedule.ts statusCodeOf)과 이 SQL.
 * 하나를 바꾸면 둘을 함께 바꾼다(e2e "상태 규칙" 테스트가 날짜 경계마다 맞춰 본다). 일정이 없는 칸은 어떤 상태에도 들지 않는다
 */
const statusSql = (code: SubscriptionStatusCode, today: string): Prisma.Sql => {
  const day = Prisma.sql`${today}::date`;
  switch (code) {
    case SubscriptionStatusCode.UPCOMING:
      return Prisma.sql`n.cancelled_at IS NULL AND s.apply_start_date > ${day} AND s.apply_end_date IS NOT NULL`;
    case SubscriptionStatusCode.OPEN:
      return Prisma.sql`n.cancelled_at IS NULL AND s.apply_start_date <= ${day} AND s.apply_end_date >= ${day}`;
    case SubscriptionStatusCode.CLOSED:
      return Prisma.sql`n.cancelled_at IS NULL AND s.apply_start_date <= ${day} AND s.apply_end_date < ${day}`;
    case SubscriptionStatusCode.CANCELLED:
      return Prisma.sql`n.cancelled_at IS NOT NULL`;
    case SubscriptionStatusCode.ALL:
      return Prisma.sql`TRUE`;
  }
};

/** 목록·검색·지도·필터 선택지가 함께 쓰는 조건. 평면도가 없어도 모든 칸을 올린다(ERD §5 규칙 6) */
const whereSql = (filter: SubscriptionListFilter): Prisma.Sql => {
  const { regionCode, agencyCode, sizeRange, keyword, bounds, status } = filter;
  const conditions = [Prisma.sql`TRUE`];
  if (regionCode !== undefined) conditions.push(Prisma.sql`s.region_code = ${regionCode}`);
  if (agencyCode !== undefined) conditions.push(Prisma.sql`n.agency_code = ${agencyCode}`);
  if (sizeRange) conditions.push(sizeRangeSql(sizeRange));
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword.text)}%`;
    const matches = [
      Prisma.sql`c.name ILIKE ${pattern}`,
      Prisma.sql`c.address ILIKE ${pattern}`,
      Prisma.sql`c.sigungu ILIKE ${pattern}`,
      Prisma.sql`n.title ILIKE ${pattern}`,
      Prisma.sql`n.supply_type ILIKE ${pattern}`,
    ];
    if (keyword.agencyCodes.length > 0)
      matches.push(Prisma.sql`n.agency_code IN (${Prisma.join(keyword.agencyCodes)})`);
    if (keyword.regionCodes.length > 0)
      matches.push(Prisma.sql`s.region_code IN (${Prisma.join(keyword.regionCodes)})`);
    conditions.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
  }
  if (bounds) {
    conditions.push(
      Prisma.sql`c.lat BETWEEN ${bounds.south} AND ${bounds.north} AND c.lng BETWEEN ${bounds.west} AND ${bounds.east}`,
    );
  }
  if (status) conditions.push(statusSql(status.code, status.today));
  return Prisma.join(conditions, ' AND ');
};

/** web 목록과 같은 정렬. D-day는 접수 중인 칸만 있다(ddayOf), 경쟁률은 공급 호수를 모르면 없다(competitionRatioOf) */
const ORDER_BY: Record<SubscriptionSort, (today: string) => Prisma.Sql> = {
  DEADLINE: (today) =>
    Prisma.sql`CASE WHEN ${statusSql(SubscriptionStatusCode.OPEN, today)} THEN s.apply_end_date - ${today}::date END ASC NULLS LAST`,
  COMPETITION: () =>
    Prisma.sql`CASE WHEN s.application_count IS NOT NULL AND s.supply_units > 0 THEN s.application_count::float8 / s.supply_units END ASC NULLS LAST`,
  HOUSEHOLDS: () => Prisma.sql`c.households DESC NULLS LAST`,
};

/** 한 줄로 받은 값을 차례로 정해진 길이씩 나눈다 */
const splitByLengths = <T>(values: readonly T[], lengths: readonly number[]): T[][] =>
  lengths.map((length, index) => {
    const start = lengths.slice(0, index).reduce((sum, previous) => sum + previous, 0);
    return values.slice(start, start + length);
  });

/** 검색·지도 행이 함께 쓰는 열. 이름은 응답 매퍼가 읽는 필드 이름과 같다 */
const SUMMARY_COLUMNS = Prisma.sql`s.id, ${DISPLAY_TITLE} AS "title", s.apply_start_date AS "applyStartDate",
  s.apply_end_date AS "applyEndDate", n.cancelled_at AS "cancelledAt"`;

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetailById(id: string): Promise<SubscriptionDetailRecord | null> {
    return this.prisma.subscription.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  /**
   * 정렬·페이지 나누기·건수까지 DB가 한다 — 조건에 맞는 칸을 모두 읽어 서버에서 정렬하면 건수에 비례해 느려진다.
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
      SELECT s.id, (count(*) OVER ())::int AS total FROM ${LISTING_FROM}
      WHERE ${where}
      ORDER BY ${ORDER_BY[sort](today)}, s.id COLLATE "C"
      LIMIT ${limit} OFFSET ${offset}`;
    if (rows.length > 0) return { ids: rows.map((row) => row.id), totalCount: rows[0].total };
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM ${LISTING_FROM} WHERE ${where}`;
    return { ids: [], totalCount: total };
  }

  findSearchRows(filter: SubscriptionListFilter): Promise<SubscriptionSearchRow[]> {
    return this.prisma.$queryRaw<SubscriptionSearchRow[]>`
      SELECT ${SUMMARY_COLUMNS} FROM ${LISTING_FROM} WHERE ${whereSql(filter)}`;
  }

  /** 두 번 읽는 사이에 칸이 바뀌어 조건에서 벗어났으면 빠지도록 같은 조건으로 다시 고른 뒤 읽는다 */
  async findListedByIds(ids: string[], filter: SubscriptionListFilter): Promise<SubscriptionListRecord[]> {
    const listed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM ${LISTING_FROM} WHERE ${whereSql(filter)} AND s.id IN (${Prisma.join(ids)})`;
    if (listed.length === 0) return [];
    return this.prisma.subscription.findMany({
      where: { id: { in: listed.map((row) => row.id) } },
      include: LIST_INCLUDE,
    });
  }

  findMarkerRows(filter: SubscriptionListFilter): Promise<SubscriptionMarkerRow[]> {
    return this.prisma.$queryRaw<SubscriptionMarkerRow[]>`
      SELECT ${SUMMARY_COLUMNS}, c.lat, c.lng, n.agency_code AS "agencyCode" FROM ${LISTING_FROM}
      WHERE ${whereSql(filter)} AND c.lat IS NOT NULL AND c.lng IS NOT NULL
      ORDER BY s.id COLLATE "C"`;
  }

  /**
   * 필터 선택지에 쓸 값. 선택지마다 목록과 같은 조건에 맞는 칸이 한 건이라도 있는지만 한 번의 쿼리로 묻는다 —
   * 칸이 없는 단지의 평면도 때문에 눌러도 0건인 선택지가 생기지 않게, 값을 모으느라 칸 전체를 읽지 않게
   */
  async findFilterOptionSources(today: string) {
    const listed = (filter: SubscriptionListFilter) =>
      Prisma.sql`EXISTS (SELECT 1 FROM ${LISTING_FROM} WHERE ${whereSql(filter)})`;
    const checks = [
      ...STORED_REGION_CODES.map((regionCode) => listed({ regionCode })),
      ...STORED_AGENCY_CODES.map((agencyCode) => listed({ agencyCode })),
      ...STORED_STATUS_CODES.map((code) => listed({ status: { code, today } })),
      ...SIZE_RANGES.map(sizeRangeListedSql),
    ];
    const [{ found }] = await this.prisma.$queryRaw<{ found: boolean[] }[]>`
      SELECT ARRAY[${Prisma.join(checks)}] AS found`;
    const [regionHits, agencyHits, statusHits, sizeHits] = splitByLengths(found, [
      STORED_REGION_CODES.length,
      STORED_AGENCY_CODES.length,
      STORED_STATUS_CODES.length,
      SIZE_RANGES.length,
    ]);
    return {
      regionCodes: STORED_REGION_CODES.filter((_code, index) => regionHits[index]),
      agencyCodes: STORED_AGENCY_CODES.filter((_code, index) => agencyHits[index]),
      statusCodes: STORED_STATUS_CODES.filter((_code, index) => statusHits[index]),
      sizeRanges: SIZE_RANGES.filter((_range, index) => sizeHits[index]),
    };
  }
}
