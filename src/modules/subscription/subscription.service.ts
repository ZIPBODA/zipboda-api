import { Injectable } from '@nestjs/common';
import { AppException } from '@/common/errors/app.exception.js';
import { Clock } from '@/common/time/clock.js';
import type { SubscriptionDetailResponse } from './dto/subscription-detail.response.js';
import { toSubscriptionDetailResponse } from './mappers/subscription-detail.mapper.js';
import { serviceDateOf } from './schedule.js';
import { SubscriptionRepository } from './subscription.repository.js';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly clock: Clock,
  ) {}

  async getDetail(id: string): Promise<SubscriptionDetailResponse> {
    const record = await this.repository.findDetailById(id);
    if (!record) throw new AppException('NOT_FOUND');
    return toSubscriptionDetailResponse(record, serviceDateOf(this.clock.now()));
  }
}
