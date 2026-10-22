import { Controller, Get, Query } from '@nestjs/common';
import { SearchQuery } from './dto/search.request.js';
import type { SearchResponse } from './dto/search.response.js';
import { SubscriptionService } from './subscription.service.js';

@Controller('search')
export class SearchController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /** API-095 통합 검색(주택·가구) */
  @Get()
  search(@Query() query: SearchQuery): Promise<SearchResponse> {
    return this.subscriptionService.search(query);
  }
}
