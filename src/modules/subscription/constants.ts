/** 공고 일정(접수 시작·마감·D-day)을 세는 기준 시간대 */
export const SERVICE_TIME_ZONE = 'Asia/Seoul';

/** 공고 식별자 길이 상한. 기관 공고번호가 들어와도 넉넉한 길이로, 비정상적으로 긴 경로는 검증에서 막는다 */
export const SUBSCRIPTION_ID_MAX_LENGTH = 100;

/**
 * 면적은 값이 아니라 전용면적 구간으로 고른다(web 목록 필터와 같은 구간).
 * 매입임대의 전용면적은 14.6475㎡처럼 소수점이 붙어 값 일치로는 맞출 수 없다. 경계는 왼쪽만 포함한다(min ≤ 면적 < max)
 */
export const SIZE_RANGES = [
  { value: '0-15', min: 0, max: 15 },
  { value: '15-20', min: 15, max: 20 },
  { value: '20-25', min: 20, max: 25 },
  { value: '25-30', min: 25, max: 30 },
  { value: '30-', min: 30, max: null },
] as const satisfies readonly { value: string; min: number; max: number | null }[];

export type SizeRange = (typeof SIZE_RANGES)[number];
export const SIZE_RANGE_VALUES: readonly string[] = SIZE_RANGES.map((range) => range.value);

/** 정의서(ITF-010)가 아니라 web 목록의 정렬을 따른다 — docs/ZIPBODA_api-contract-delta.md §5 */
export const SUBSCRIPTION_SORTS = ['DEADLINE', 'COMPETITION', 'HOUSEHOLDS'] as const;
export type SubscriptionSort = (typeof SUBSCRIPTION_SORTS)[number];
export const DEFAULT_SUBSCRIPTION_SORT: SubscriptionSort = 'DEADLINE';

export const DEFAULT_PAGE_SIZE = 20;
/** web 지도 첫 화면은 목록 데이터로 핀까지 그려 한 번에 많이 받는다. 그보다 많으면 페이지를 나눠 받게 한다 */
export const MAX_PAGE_SIZE = 100;
/** 페이지 번호 상한. 이보다 뒤에는 담을 공고가 없고, 지나치게 큰 수는 응답의 page가 지수 표기(1e+23)로 망가진다 */
export const MAX_PAGE = 10_000;

export const KEYWORD_MAX_LENGTH = 100;

/** 지도 영역 쿼리 "남,서,북,동" — 숫자 네 개를 쉼표로 잇는다 */
export const BOUNDS_PATTERN = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;
export const MAX_LATITUDE = 90;
export const MAX_LONGITUDE = 180;
