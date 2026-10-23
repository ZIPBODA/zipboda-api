import { competitionOf } from '../competition.js';
import type { SubscriptionListItemResponse, SubscriptionMapMarkerResponse } from '../dto/subscription-list.response.js';
import type { SearchCandidate } from '../list-rules.js';
import { ddayOf, statusCodeOf } from '../schedule.js';
import type {
  SubscriptionListRecord,
  SubscriptionMarkerRow,
  SubscriptionSearchRow,
} from '../subscription.repository.js';
import { agencyCodeOf, regionCodeOf, scheduleOf } from './subscription-fields.js';

export const toSearchCandidate = (row: SubscriptionSearchRow, today: string): SearchCandidate => ({
  id: row.id,
  title: row.title,
  dday: ddayOf(scheduleOf(row), today),
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
