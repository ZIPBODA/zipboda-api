import { Module } from '@nestjs/common';
import { SearchController } from './search.controller.js';
import { SubscriptionController } from './subscription.controller.js';
import { SubscriptionRepository } from './subscription.repository.js';
import { SubscriptionService } from './subscription.service.js';

@Module({
  controllers: [SubscriptionController, SearchController],
  providers: [SubscriptionService, SubscriptionRepository],
})
export class SubscriptionModule {}
