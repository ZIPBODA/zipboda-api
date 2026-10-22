import {
  isStoredAgencyCode,
  isStoredRegionCode,
  type StoredAgencyCode,
  type StoredRegionCode,
} from '@/common/constants/interface-codes.js';
import { toIsoDate, type ApplySchedule } from '../schedule.js';

export const isoDateOrNull = (date: Date | null): string | null => (date ? toIsoDate(date) : null);

// 정의서에 없는 코드가 저장돼 있으면 적재 쪽 결함이다 — 응답을 지어내지 않고 서버 오류로 드러낸다
export const agencyCodeOf = (value: number): StoredAgencyCode => {
  if (!isStoredAgencyCode(value)) throw new Error(`정의되지 않은 공급기관 코드: ${value}`);
  return value;
};

export const regionCodeOf = (value: number): StoredRegionCode => {
  if (!isStoredRegionCode(value)) throw new Error(`정의되지 않은 지역 코드: ${value}`);
  return value;
};

export const scheduleOf = (record: {
  applyStartDate: Date | null;
  applyEndDate: Date | null;
  cancelledAt: Date | null;
}): ApplySchedule => ({
  applyStartDate: isoDateOrNull(record.applyStartDate),
  applyEndDate: isoDateOrNull(record.applyEndDate),
  cancelled: record.cancelledAt !== null,
});
