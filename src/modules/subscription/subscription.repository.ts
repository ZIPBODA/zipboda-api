import { Injectable } from '@nestjs/common';
import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import { PrismaService } from '@/database/prisma.service.js';
import type { Prisma } from '@/database/generated/client.js';
import type { SizeRange } from './constants.js';
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

/** 정렬에 필요한 열만 — 조건에 맞는 공고 전체를 읽는 단계라 도면·긴 글자는 싣지 않는다 */
const SORT_SELECT = {
  id: true,
  applyStartDate: true,
  applyEndDate: true,
  cancelledAt: true,
  applicationCount: true,
  supplyUnits: true,
  households: true,
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
export type SubscriptionSortRow = Prisma.SubscriptionGetPayload<{ select: typeof SORT_SELECT }>;
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

/**
 * schedule.ts의 statusCodeOf와 같은 규칙을 SQL 조건으로 쓴다 — 한쪽을 바꾸면 다른 쪽도 함께 바꾼다
 * (e2e "상태 규칙" 테스트가 날짜 경계마다 두 규칙을 맞춰 본다). 일정이 없는 공고는 어떤 상태에도 들지 않는다
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

const whereOf = (filter: SubscriptionListFilter): Prisma.SubscriptionWhereInput => {
  const { regionCode, agencyCode, sizeRange, keyword, bounds, status } = filter;
  const conditions: Prisma.SubscriptionWhereInput[] = [LISTED];
  if (regionCode !== undefined) conditions.push({ regionCode });
  if (agencyCode !== undefined) conditions.push({ agencyCode });
  if (sizeRange) {
    const exclusiveArea = sizeRange.max === null ? { gte: sizeRange.min } : { gte: sizeRange.min, lt: sizeRange.max };
    conditions.push({ floorplans: { some: { exclusiveArea } } });
  }
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

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetailById(id: string): Promise<SubscriptionDetailRecord | null> {
    return this.prisma.subscription.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  findSortRows(filter: SubscriptionListFilter): Promise<SubscriptionSortRow[]> {
    return this.prisma.subscription.findMany({ where: whereOf(filter), select: SORT_SELECT });
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
   * 지역·기관·면적은 groupBy(SQL GROUP BY)로, 상태는 코드마다 한 건이라도 있는지만 묻는다.
   * 도면은 모두 도면이 있는 공고에 딸려 있어 목록 조건(LISTED)을 따로 걸 필요가 없다
   */
  async findFilterOptionSources(today: string) {
    const [regions, agencies, areas, ...statusHits] = await Promise.all([
      this.prisma.subscription.groupBy({ by: ['regionCode'], where: LISTED, orderBy: { regionCode: 'asc' } }),
      this.prisma.subscription.groupBy({ by: ['agencyCode'], where: LISTED, orderBy: { agencyCode: 'asc' } }),
      this.prisma.floorplan.groupBy({ by: ['exclusiveArea'], where: { exclusiveArea: { not: null } } }),
      ...STORED_STATUS_CODES.map((code) =>
        this.prisma.subscription.findFirst({
          where: { AND: [LISTED, statusWhere(code, today)] },
          select: { id: true },
        }),
      ),
    ]);
    return {
      regionCodes: regions.map((row) => row.regionCode),
      agencyCodes: agencies.map((row) => row.agencyCode),
      statusCodes: STORED_STATUS_CODES.filter((_code, index) => statusHits[index] !== null),
      exclusiveAreas: areas.flatMap((row) => (row.exclusiveArea === null ? [] : [row.exclusiveArea.toNumber()])),
    };
  }
}
