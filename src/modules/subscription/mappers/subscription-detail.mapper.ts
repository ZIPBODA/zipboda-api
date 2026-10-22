import { AGENCY_NAME } from '@/common/constants/interface-codes.js';
import { competitionOf } from '../competition.js';
import type { SubscriptionDetailResponse } from '../dto/subscription-detail.response.js';
import { ddayOf, statusCodeOf } from '../schedule.js';
import type { SubscriptionDetailRecord } from '../subscription.repository.js';
import { agencyCodeOf, isoDateOrNull, regionCodeOf, scheduleOf } from './subscription-fields.js';

type UnitRecord = SubscriptionDetailRecord['units'][number];

// 주택형은 숫자 문자열이라 DB에서 문자열로 정렬하면 "114"가 "39"보다 앞선다
const bySizeThenType = (a: UnitRecord, b: UnitRecord): number =>
  Number(a.sizeType) - Number(b.sizeType) ||
  (a.unitType ?? '').localeCompare(b.unitType ?? '') ||
  a.id.localeCompare(b.id);

export const toSubscriptionDetailResponse = (
  record: SubscriptionDetailRecord,
  today: string,
): SubscriptionDetailResponse => {
  const schedule = scheduleOf(record);
  const agencyCode = agencyCodeOf(record.agencyCode);
  return {
    id: record.id,
    title: record.title,
    agencyCode,
    agencyName: AGENCY_NAME[agencyCode],
    statusCode: statusCodeOf(schedule, today),
    dday: ddayOf(schedule, today),
    region: regionCodeOf(record.regionCode),
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    postDate: isoDateOrNull(record.postDate),
    applyStartDate: schedule.applyStartDate,
    deadline: schedule.applyEndDate,
    contractDate: isoDateOrNull(record.contractDate),
    supplyType: record.supplyType,
    households: record.households,
    supplyUnits: record.supplyUnits,
    recruitCount: record.recruitCount,
    applicationCount: record.applicationCount,
    moveIn: record.moveInMonth,
    competition: competitionOf(record.applicationCount, record.supplyUnits),
    imageUrl: record.imageUrl,
    units: [...record.units].sort(bySizeThenType).map((unit) => ({
      size: unit.sizeType,
      type: unit.unitType,
      households: unit.households,
      price: unit.price,
    })),
    applyUrl: record.applyUrl,
    floorplans: record.floorplans.map((plan) => ({
      id: plan.id,
      size: plan.sizeType,
      type: plan.unitType,
      floor: plan.floor,
      unitNumber: plan.unitNumber,
      exclusiveArea: plan.exclusiveArea === null ? null : plan.exclusiveArea.toNumber(),
      has2d: plan.image2dUrl !== null,
      has3d: plan.has3d,
    })),
  };
};
