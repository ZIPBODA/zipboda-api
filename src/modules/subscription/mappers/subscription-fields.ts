import {
  REGION_NAME,
  isStoredAgencyCode,
  isStoredRegionCode,
  type StoredAgencyCode,
  type StoredRegionCode,
} from '@/common/constants/interface-codes.js';
import { FLOORPLAN_VISIBLE_MATCHES } from '../constants.js';
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

/** 공고 취소는 공고에, 접수 일정은 칸에 있다 */
export const scheduleOf = (
  subscription: { applyStartDate: Date | null; applyEndDate: Date | null },
  cancelledAt: Date | null,
): ApplySchedule => ({
  applyStartDate: isoDateOrNull(subscription.applyStartDate),
  applyEndDate: isoDateOrNull(subscription.applyEndDate),
  cancelled: cancelledAt !== null,
});

/** 칸의 이름은 단지명이다. 단지 정보가 없는 공고 단위 칸은 공고명으로 보인다 */
export const displayTitleOf = (complex: { name: string } | null, noticeTitle: string): string =>
  complex?.name ?? noticeTitle;

/**
 * 주소가 없는 단지(매입임대 건물 대부분)와 공고 단위 칸도 위치를 보이도록 '지역 시군구', 그것도 없으면 지역 이름을 준다.
 * 응답의 주소는 빈 값을 두지 않는다(web 카드·상세가 늘 위치 줄을 그린다)
 */
export const addressOf = (
  complex: { address: string | null; sigungu: string | null } | null,
  regionCode: StoredRegionCode,
): string => {
  if (complex?.address) return complex.address;
  if (complex?.sigungu) return `${REGION_NAME[regionCode]} ${complex.sigungu}`;
  return REGION_NAME[regionCode];
};

/** 이름으로만 이은 단지는 같은 이름의 다른 건물일 수 있어 평면도를 보여 주지 않는다(ERD §5 규칙 8) */
export const isFloorplanVisible = (complexMatch: string | null): boolean =>
  complexMatch !== null && FLOORPLAN_VISIBLE_MATCHES.includes(complexMatch);
