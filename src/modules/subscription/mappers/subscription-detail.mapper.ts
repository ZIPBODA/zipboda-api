import { AGENCY_NAME } from '@/common/constants/interface-codes.js';
import { competitionOf } from '../competition.js';
import type { SubscriptionDetailResponse } from '../dto/subscription-detail.response.js';
import { compareCodePoints } from '../list-rules.js';
import { ddayOf, statusCodeOf } from '../schedule.js';
import type { SubscriptionDetailRecord } from '../subscription.repository.js';
import {
  addressOf,
  agencyCodeOf,
  displayTitleOf,
  imageUrlOf,
  isFloorplanVisible,
  isoDateOrNull,
  regionCodeOf,
  scheduleOf,
} from './subscription-fields.js';
import { unitPriceOf } from './unit-price.js';

type UnitRecord = SubscriptionDetailRecord['units'][number];

const ALL_DIGITS = /^\d+$/;

/** 전용면적이 구간으로만 온 주택형은 구간 하한으로 줄 세운다 */
const sortAreaOf = (unit: UnitRecord): number | null => (unit.exclusiveArea ?? unit.areaMin)?.toNumber() ?? null;

const nullsLast = <T>(a: T | null, b: T | null, compare: (left: T, right: T) => number): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
};

/** 호수는 숫자끼리면 크기로("402" < "1001"), 아니면 목록 SQL(COLLATE "C")과 같은 코드 포인트 순 — 서버 로캘에 따라 바뀌지 않게 */
const compareUnitNumbers = (a: string, b: string): number =>
  ALL_DIGITS.test(a) && ALL_DIGITS.test(b) ? Number(a) - Number(b) : compareCodePoints(a, b);

const byAreaThenTypeThenUnit = (a: UnitRecord, b: UnitRecord): number =>
  nullsLast(sortAreaOf(a), sortAreaOf(b), (left, right) => left - right) ||
  nullsLast(a.unitType, b.unitType, compareCodePoints) ||
  nullsLast(a.unitNumber, b.unitNumber, compareUnitNumbers) ||
  a.displayOrder - b.displayOrder;

export const toSubscriptionDetailResponse = (
  record: SubscriptionDetailRecord,
  today: string,
): SubscriptionDetailResponse => {
  const { notice, complex } = record;
  const schedule = scheduleOf(record, notice.cancelledAt);
  const agencyCode = agencyCodeOf(notice.agencyCode);
  const region = regionCodeOf(record.regionCode);
  const floorplans = complex && isFloorplanVisible(record.complexMatch) ? complex.floorplans : [];
  return {
    id: record.id,
    title: displayTitleOf(complex, notice.title),
    noticeTitle: notice.title,
    agencyCode,
    agencyName: AGENCY_NAME[agencyCode],
    statusCode: statusCodeOf(schedule, today),
    dday: ddayOf(schedule, today),
    region,
    address: addressOf(complex, region),
    lat: complex?.lat ?? null,
    lng: complex?.lng ?? null,
    postDate: isoDateOrNull(notice.postDate),
    applyStartDate: schedule.applyStartDate,
    deadline: schedule.applyEndDate,
    contractDate: isoDateOrNull(record.contractStartDate),
    supplyType: notice.supplyType,
    households: complex?.households ?? null,
    supplyUnits: record.supplyUnits,
    recruitCount: record.recruitCount,
    applicationCount: record.applicationCount,
    moveIn: record.moveInMonth,
    competition: competitionOf(record.applicationCount, record.supplyUnits),
    imageUrl: imageUrlOf(complex),
    units: [...record.units].sort(byAreaThenTypeThenUnit).map((unit) => ({
      size: unit.sizeType,
      type: unit.unitType,
      label: unit.label,
      floor: unit.floorLabel,
      unitNumber: unit.unitNumber,
      households: unit.supplyHouseholds ?? unit.totalHouseholds,
      price: unitPriceOf(unit),
    })),
    applyUrl: notice.applyUrl,
    floorplans: floorplans.map((plan) => ({
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
