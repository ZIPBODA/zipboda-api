import { Module } from '@nestjs/common';
import { FloorplanController } from './floorplan.controller.js';
import { SearchController } from './search.controller.js';
import { SubscriptionController } from './subscription.controller.js';
import { SubscriptionRepository } from './subscription.repository.js';
import { SubscriptionService } from './subscription.service.js';

@Module({
  controllers: [SubscriptionController, SearchController, FloorplanController],
  providers: [SubscriptionService, SubscriptionRepository],
})
export class SubscriptionModule {}
