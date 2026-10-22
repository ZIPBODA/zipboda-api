import {
  AGENCY_NAME,
  isStoredAgencyCode,
  isStoredRegionCode,
  type StoredAgencyCode,
  type StoredRegionCode,
} from '@/common/constants/interface-codes.js';
import type { SubscriptionDetailResponse } from '../dto/subscription-detail.response.js';
import { competitionOf, statusCodeOf, toIsoDate, type ApplySchedule } from '../schedule.js';
import type { SubscriptionDetailRecord } from '../subscription.repository.js';

const isoDateOrNull = (date: Date | null): string | null => (date ? toIsoDate(date) : null);

// 정의서에 없는 코드가 저장돼 있으면 적재 쪽 결함이다 — 응답을 지어내지 않고 서버 오류로 드러낸다
const agencyCodeOf = (value: number): StoredAgencyCode => {
  if (!isStoredAgencyCode(value)) throw new Error(`정의되지 않은 공급기관 코드: ${value}`);
  return value;
};

const regionCodeOf = (value: number): StoredRegionCode => {
  if (!isStoredRegionCode(value)) throw new Error(`정의되지 않은 지역 코드: ${value}`);
  return value;
};

type UnitRecord = SubscriptionDetailRecord['units'][number];

// 주택형은 숫자 문자열이라 DB에서 문자열로 정렬하면 "114"가 "39"보다 앞선다
const bySizeThenType = (a: UnitRecord, b: UnitRecord): number =>
  Number(a.sizeType) - Number(b.sizeType) ||
  (a.unitType ?? '').localeCompare(b.unitType ?? '') ||
  a.id.localeCompare(b.id);

export const scheduleOf = (
  record: Pick<SubscriptionDetailRecord, 'applyStartDate' | 'applyEndDate' | 'cancelledAt'>,
): ApplySchedule => ({
  applyStartDate: isoDateOrNull(record.applyStartDate),
  applyEndDate: isoDateOrNull(record.applyEndDate),
  cancelled: record.cancelledAt !== null,
});

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
    region: regionCodeOf(record.regionCode),
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    postDate: isoDateOrNull(record.postDate),
    applyStartDate: schedule.applyStartDate,
    deadline: schedule.applyEndDate,
    supplyType: record.supplyType,
    households: record.households,
    moveIn: record.moveInMonth,
    competition: competitionOf(record.applicationCount, record.supplyUnits),
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
      has2d: plan.image2dUrl !== null,
      has3d: plan.has3d,
    })),
  };
};
