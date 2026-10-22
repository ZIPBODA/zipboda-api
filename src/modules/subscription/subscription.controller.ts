import { Controller, Get, Param } from '@nestjs/common';
import type { SubscriptionDetailResponse } from './dto/subscription-detail.response.js';
import { SubscriptionIdParams } from './dto/subscription-id.params.js';
import { SubscriptionService } from './subscription.service.js';

// 고정 경로(/subscriptions/map 등)는 ':id'보다 먼저 선언해야 한다 — 뒤에 두면 'map'이 공고 id로 잡힌다
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /** API-011 청약 공고 상세 */
  @Get(':id')
  getDetail(@Param() params: SubscriptionIdParams): Promise<SubscriptionDetailResponse> {
    return this.subscriptionService.getDetail(params.id);
  }
}
