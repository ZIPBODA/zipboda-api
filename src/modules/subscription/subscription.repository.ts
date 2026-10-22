import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service.js';
import type { Prisma } from '@/database/generated/client.js';

// 주택형 순서는 숫자로 매겨야 해서 매퍼가 정렬한다
const DETAIL_INCLUDE = {
  units: true,
  floorplans: { orderBy: { displayOrder: 'asc' } },
} satisfies Prisma.SubscriptionInclude;

export type SubscriptionDetailRecord = Prisma.SubscriptionGetPayload<{ include: typeof DETAIL_INCLUDE }>;

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetailById(id: string): Promise<SubscriptionDetailRecord | null> {
    return this.prisma.subscription.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }
}
