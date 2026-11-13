import type { FloorplanDetailResponse } from '../dto/floorplan-detail.response.js';
import type { SubscriptionFloorplanResponse } from '../dto/subscription-detail.response.js';
import type { FloorplanRecord, SubscriptionDetailRecord } from '../subscription.repository.js';

type FloorplanRow = NonNullable<SubscriptionDetailRecord['complex']>['floorplans'][number];

export const toFloorplanResponse = (plan: FloorplanRow): SubscriptionFloorplanResponse => ({
  id: plan.id,
  size: plan.sizeType,
  type: plan.unitType,
  floor: plan.floor,
  unitNumber: plan.unitNumber,
  exclusiveArea: plan.exclusiveArea === null ? null : plan.exclusiveArea.toNumber(),
  image2dUrl: plan.image2dUrl,
  has2d: plan.image2dUrl !== null,
  has3d: plan.has3d,
});

export const toFloorplanDetailResponse = (
  record: FloorplanRecord,
  subscriptionId: string | null,
): FloorplanDetailResponse => ({
  ...toFloorplanResponse(record),
  complexName: record.complex.name,
  subscriptionId,
});
