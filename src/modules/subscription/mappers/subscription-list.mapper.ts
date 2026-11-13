import { competitionOf } from '../competition.js';
import type { SubscriptionListItemResponse, SubscriptionMapMarkerResponse } from '../dto/subscription-list.response.js';
import type { SearchCandidate } from '../list-rules.js';
import { ddayOf, statusCodeOf } from '../schedule.js';
import type {
  SubscriptionListRecord,
  SubscriptionMarkerRow,
  SubscriptionSearchRow,
} from '../subscription.repository.js';
import {
  addressOf,
  agencyCodeOf,
  displayTitleOf,
  imageUrlOf,
  isFloorplanVisible,
  regionCodeOf,
  scheduleOf,
} from './subscription-fields.js';

export const toSearchCandidate = (row: SubscriptionSearchRow, today: string): SearchCandidate => ({
  id: row.id,
  title: row.title,
  dday: ddayOf(scheduleOf(row, row.cancelledAt), today),
});

/** 주택형의 전용면적과 보여 주는 평면도의 전용면적. 구간으로만 온 주택형("70~80㎡")은 값이 없어 넣지 않는다 */
export const sizesOf = (record: SubscriptionListRecord): number[] => {
  const floorplans = record.complex && isFloorplanVisible(record.complexMatch) ? record.complex.floorplans : [];
  const areas = [...record.units, ...floorplans].flatMap(({ exclusiveArea }) =>
    exclusiveArea === null ? [] : [exclusiveArea.toNumber()],
  );
  return [...new Set(areas)].sort((a, b) => a - b);
};

export const toListItemResponse = (record: SubscriptionListRecord, today: string): SubscriptionListItemResponse => {
  const { notice, complex } = record;
  const schedule = scheduleOf(record, notice.cancelledAt);
  const region = regionCodeOf(record.regionCode);
  return {
    id: record.id,
    title: displayTitleOf(complex, notice.title),
    noticeTitle: notice.title,
    agencyCode: agencyCodeOf(notice.agencyCode),
    region,
    address: addressOf(complex, region),
    lat: complex?.lat ?? null,
    lng: complex?.lng ?? null,
    supplyType: notice.supplyType,
    sizes: sizesOf(record),
    households: complex?.households ?? null,
    applicationCount: record.applicationCount,
    competition: competitionOf(record.applicationCount, record.supplyUnits),
    moveIn: record.moveInMonth,
    deadline: schedule.applyEndDate,
    dday: ddayOf(schedule, today),
    statusCode: statusCodeOf(schedule, today),
    imageUrl: imageUrlOf(complex),
  };
};

/** 좌표가 없는 칸은 지도에 올리지 않는다 */
export const toMapMarkerResponse = (
  row: SubscriptionMarkerRow,
  today: string,
): SubscriptionMapMarkerResponse | null => {
  if (row.lat === null || row.lng === null) return null;
  const schedule = scheduleOf(row, row.cancelledAt);
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
