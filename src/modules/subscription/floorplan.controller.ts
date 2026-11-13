import { Controller, Get, Param } from '@nestjs/common';
import type { FloorplanDetailResponse } from './dto/floorplan-detail.response.js';
import { FloorplanIdParams } from './dto/floorplan-id.request.js';
import { SubscriptionService } from './subscription.service.js';

@Controller('floorplans')
export class FloorplanController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /** API-031 평면도 상세 */
  @Get(':id')
  getDetail(@Param() params: FloorplanIdParams): Promise<FloorplanDetailResponse> {
    return this.subscriptionService.getFloorplan(params.id);
  }
}
