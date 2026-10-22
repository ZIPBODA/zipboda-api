import { competitionOf, competitionRatioOf } from '../competition.js';
import type { SubscriptionListItemResponse, SubscriptionMapMarkerResponse } from '../dto/subscription-list.response.js';
import type { SortableSubscription } from '../list-rules.js';
import { ddayOf, statusCodeOf } from '../schedule.js';
import type { SubscriptionListRecord, SubscriptionMarkerRow, SubscriptionSortRow } from '../subscription.repository.js';
import { agencyCodeOf, regionCodeOf, scheduleOf } from './subscription-fields.js';

/** D-day·경쟁률은 날마다 또는 두 열로 계산하는 값이라 DB에서 바로 정렬하지 못한다 — 가벼운 열만 읽어 여기서 붙인다 */
export const toSortable = (row: SubscriptionSortRow, today: string): SortableSubscription => ({
  id: row.id,
  dday: ddayOf(scheduleOf(row), today),
  competitionRatio: competitionRatioOf(row.applicationCount, row.supplyUnits),
  households: row.households,
});

export const sizesOf = (record: SubscriptionListRecord): number[] =>
  [
    ...new Set(
      record.floorplans.flatMap((plan) => (plan.exclusiveArea === null ? [] : [plan.exclusiveArea.toNumber()])),
    ),
  ].sort((a, b) => a - b);

export const toListItemResponse = (record: SubscriptionListRecord, today: string): SubscriptionListItemResponse => {
  const schedule = scheduleOf(record);
  return {
    id: record.id,
    title: record.title,
    agencyCode: agencyCodeOf(record.agencyCode),
    region: regionCodeOf(record.regionCode),
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    supplyType: record.supplyType,
    sizes: sizesOf(record),
    households: record.households,
    applicationCount: record.applicationCount,
    competition: competitionOf(record.applicationCount, record.supplyUnits),
    moveIn: record.moveInMonth,
    deadline: schedule.applyEndDate,
    dday: ddayOf(schedule, today),
    statusCode: statusCodeOf(schedule, today),
    imageUrl: record.imageUrl,
  };
};

/** 좌표가 없는 공고는 지도에 올리지 않는다 */
export const toMapMarkerResponse = (
  row: SubscriptionMarkerRow,
  today: string,
): SubscriptionMapMarkerResponse | null => {
  if (row.lat === null || row.lng === null) return null;
  const schedule = scheduleOf(row);
  return {
    id: row.id,
    title: row.title,
    lat: row.lat,
    lng: row.lng,
    dday: ddayOf(schedule, today),
    agencyCode: agencyCodeOf(row.agencyCode),
    statusCode: statusCodeOf(schedule, today),
  };
};
