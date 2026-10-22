import { Controller, Get, Param, Query } from '@nestjs/common';
import type { SubscriptionDetailResponse } from './dto/subscription-detail.response.js';
import { SubscriptionListQuery, SubscriptionMapQuery } from './dto/subscription-filter.request.js';
import { SubscriptionIdParams } from './dto/subscription-id.request.js';
import type {
  SubscriptionFilterOptionsResponse,
  SubscriptionListResponse,
  SubscriptionMapResponse,
} from './dto/subscription-list.response.js';
import { SubscriptionService } from './subscription.service.js';

// 고정 경로(/subscriptions/map 등)는 ':id'보다 먼저 선언해야 한다 — 뒤에 두면 'map'이 공고 id로 잡힌다
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /** API-010 청약 공고 목록·검색·필터 */
  @Get()
  list(@Query() query: SubscriptionListQuery): Promise<SubscriptionListResponse> {
    return this.subscriptionService.list(query);
  }

  /** API-012 지도용 공고 목록 */
  @Get('map')
  mapMarkers(@Query() query: SubscriptionMapQuery): Promise<SubscriptionMapResponse> {
    return this.subscriptionService.mapMarkers(query);
  }

  /** 목록 필터 선택지 — 정의서 미등록(docs/ZIPBODA_api-contract-delta.md) */
  @Get('filter-options')
  filterOptions(): Promise<SubscriptionFilterOptionsResponse> {
    return this.subscriptionService.filterOptions();
  }

  /** API-011 청약 공고 상세 */
  @Get(':id')
  getDetail(@Param() params: SubscriptionIdParams): Promise<SubscriptionDetailResponse> {
    return this.subscriptionService.getDetail(params.id);
  }
}
