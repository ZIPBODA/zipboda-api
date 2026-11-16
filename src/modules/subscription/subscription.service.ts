import { Injectable } from '@nestjs/common';
import { AgencyCode, RegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import { AppException } from '@/common/errors/app.exception.js';
import { Clock } from '@/common/time/clock.js';
import type { FloorplanDetailResponse } from './dto/floorplan-detail.response.js';
import type { SearchQuery } from './dto/search.request.js';
import type { SearchResponse } from './dto/search.response.js';
import type { SubscriptionDetailResponse } from './dto/subscription-detail.response.js';
import type {
  SubscriptionFilterQuery,
  SubscriptionListQuery,
  SubscriptionMapQuery,
} from './dto/subscription-filter.request.js';
import type {
  SubscriptionFilterOptionsResponse,
  SubscriptionListItemResponse,
  SubscriptionListResponse,
  SubscriptionMapResponse,
} from './dto/subscription-list.response.js';
import {
  codesMatchingKeyword,
  normalizeKeyword,
  parseBounds,
  sizeRangeOf,
  sortSearchResults,
  type GeoBounds,
} from './list-rules.js';
import { toFloorplanDetailResponse } from './mappers/floorplan.mapper.js';
import { toSubscriptionDetailResponse } from './mappers/subscription-detail.mapper.js';
import { agencyCodeOf, regionCodeOf } from './mappers/subscription-fields.js';
import { toListItemResponse, toMapMarkerResponse, toSearchCandidate } from './mappers/subscription-list.mapper.js';
import { serviceDateOf } from './schedule.js';
import { SubscriptionRepository, type SubscriptionListFilter } from './subscription.repository.js';

const uniqueSorted = <T extends number>(values: readonly T[]): T[] => [...new Set(values)].sort((a, b) => a - b);

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly clock: Clock,
  ) {}

  async getDetail(id: string): Promise<SubscriptionDetailResponse> {
    const record = await this.repository.findDetailById(id);
    if (!record) throw new AppException('NOT_FOUND');
    return toSubscriptionDetailResponse(record, this.today());
  }

  async getFloorplan(id: string): Promise<FloorplanDetailResponse> {
    const record = await this.repository.findFloorplanById(id);
    if (!record) throw new AppException('NOT_FOUND');
    const subscriptionId = await this.repository.findFloorplanSubscriptionId(record.complexId, this.today());
    return toFloorplanDetailResponse(record, subscriptionId);
  }

  /** 도면까지 담은 행은 무거워서, DB가 정렬·페이지로 고른 id 몫만 다시 읽는다 */
  async list(query: SubscriptionListQuery): Promise<SubscriptionListResponse> {
    const today = this.today();
    const filter = this.filterOf(query, today);
    const { ids, totalCount } = await this.repository.findPage(filter, {
      sort: query.sort,
      today,
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    });
    return {
      items: await this.listItemsInOrder(ids, filter, today),
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
    };
  }

  /** 주택은 목록 검색어와 같은 필드에서 찾는다 — web 헤더 검색과 목록 검색이 같은 공고를 찾아야 해서다 */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const keyword = normalizeKeyword(query.q);
    if (!keyword) throw new AppException('VALIDATION_ERROR');
    const today = this.today();
    const filter: SubscriptionListFilter = { keyword: { text: keyword, ...codesMatchingKeyword(keyword) } };
    const rows = await this.repository.findSearchRows(filter);
    const ranked = sortSearchResults(
      rows.map((row) => toSearchCandidate(row, today)),
      keyword,
    );
    const start = (query.page - 1) * query.pageSize;
    const pageIds = ranked.slice(start, start + query.pageSize).map((entry) => entry.id);
    return {
      page: query.page,
      pageSize: query.pageSize,
      subscriptions: { items: await this.listItemsInOrder(pageIds, filter, today), totalCount: ranked.length },
      products: { items: [], totalCount: 0 },
    };
  }

  /** web 지도 옆 목록이 핀마다 카드를 그려, 핀도 목록 한 칸과 같은 모양·같은 정렬로 준다 */
  async mapMarkers(query: SubscriptionMapQuery): Promise<SubscriptionMapResponse> {
    const today = this.today();
    const bounds = query.bounds ? parseBounds(query.bounds) : undefined;
    const filter = this.filterOf(query, today, bounds);
    const [ids, totalCount] = await Promise.all([
      this.repository.findMarkerIds(filter, query.sort, today),
      this.repository.countListed(this.filterOf(query, today)),
    ]);
    const items = await this.listItemsInOrder(ids, filter, today);
    return { markers: items.flatMap(toMapMarkerResponse), totalCount };
  }

  /** 걸린 조건과 상관없이 목록 전체로 센다 — 지금 조건으로 세면 선택지가 누를 때마다 사라져 되돌아갈 수 없다 */
  async filterOptions(): Promise<SubscriptionFilterOptionsResponse> {
    const sources = await this.repository.findFilterOptionSources(this.today());
    return {
      regions: uniqueSorted(sources.regionCodes.map(regionCodeOf)),
      agencies: uniqueSorted(sources.agencyCodes.map(agencyCodeOf)),
      statuses: sources.statusCodes,
      sizeRanges: sources.sizeRanges.map(({ value, min, max }) => ({ value, min, max })),
    };
  }

  private today(): string {
    return serviceDateOf(this.clock.now());
  }

  /** DB는 id 목록의 순서를 지키지 않아 정렬 순서대로 다시 세운다. 두 번 읽는 사이에 지워지거나 조건에서 벗어난 공고는 건너뛴다 */
  private async listItemsInOrder(
    ids: string[],
    filter: SubscriptionListFilter,
    today: string,
  ): Promise<SubscriptionListItemResponse[]> {
    const records = ids.length === 0 ? [] : await this.repository.findListedByIds(ids, filter);
    const recordById = new Map(records.map((record) => [record.id, record]));
    return ids.flatMap((id) => {
      const record = recordById.get(id);
      return record ? [toListItemResponse(record, today)] : [];
    });
  }

  private filterOf(filter: SubscriptionFilterQuery, today: string, bounds?: GeoBounds): SubscriptionListFilter {
    const keyword = normalizeKeyword(filter.keyword);
    const status =
      filter.status === undefined || filter.status === SubscriptionStatusCode.ALL ? undefined : filter.status;
    return {
      regionCode: filter.region === RegionCode.ALL ? undefined : filter.region,
      agencyCode: filter.agency === AgencyCode.ALL ? undefined : filter.agency,
      sizeRange: sizeRangeOf(filter.size),
      keyword: keyword ? { text: keyword, ...codesMatchingKeyword(keyword) } : undefined,
      bounds,
      status: status === undefined ? undefined : { code: status, today },
    };
  }
}
