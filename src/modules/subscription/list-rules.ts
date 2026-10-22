import {
  AGENCY_NAME,
  AgencyCode,
  REGION_NAME,
  isStoredAgencyCode,
  isStoredRegionCode,
  type StoredAgencyCode,
  type StoredRegionCode,
} from '@/common/constants/interface-codes.js';
import {
  BOUNDS_PATTERN,
  DEFAULT_SUBSCRIPTION_SORT,
  MAX_LATITUDE,
  MAX_LONGITUDE,
  SIZE_RANGES,
  type SizeRange,
  type SubscriptionSort,
} from './constants.js';

export const sizeRangeOf = (value: string | undefined): SizeRange | undefined =>
  SIZE_RANGES.find((range) => range.value === value);

export const isInSizeRange = (exclusiveArea: number, range: SizeRange): boolean =>
  range.min <= exclusiveArea && (range.max === null || exclusiveArea < range.max);

/** 검색어는 앞뒤 공백을 버리고 연속 공백을 하나로 줄인 뒤 대소문자 없이 찾는다(web 검색과 같은 규칙) */
export const normalizeKeyword = (raw: string | undefined): string | null => {
  const keyword = (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return keyword || null;
};

const storedAgencyCodes = Object.keys(AGENCY_NAME).map(Number).filter(isStoredAgencyCode);
const storedRegionCodes = Object.keys(REGION_NAME).map(Number).filter(isStoredRegionCode);

/**
 * 공급기관·지역은 코드로 저장돼 있어 글자로 찾을 수 없다. 검색어가 기관 약칭(LH 등)이나 지역 이름(서울 등)에
 * 들어 있으면 그 코드를 함께 조건으로 쓴다
 */
export const codesMatchingKeyword = (
  keyword: string,
): { agencyCodes: StoredAgencyCode[]; regionCodes: StoredRegionCode[] } => ({
  agencyCodes: storedAgencyCodes.filter((code) => AgencyCode[code].toLowerCase().includes(keyword)),
  regionCodes: storedRegionCodes.filter((code) => REGION_NAME[code].toLowerCase().includes(keyword)),
});

export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const isLatitude = (value: number): boolean => -MAX_LATITUDE <= value && value <= MAX_LATITUDE;
const isLongitude = (value: number): boolean => -MAX_LONGITUDE <= value && value <= MAX_LONGITUDE;

/**
 * 형식만 맞으면 지나치게 긴 숫자가 Infinity가 되어 조건이 `lat <= NULL`로 바뀌고 오류 없이 빈 결과가 된다.
 * 그래서 유한한 위경도인지와 남≤북·서≤동까지 본다
 */
export const isGeoBoundsText = (text: string): boolean => {
  if (!BOUNDS_PATTERN.test(text)) return false;
  const [south, west, north, east] = text.split(',').map(Number);
  if (![south, west, north, east].every(Number.isFinite)) return false;
  return (
    isLatitude(south) && isLatitude(north) && isLongitude(west) && isLongitude(east) && south <= north && west <= east
  );
};

/** isGeoBoundsText를 통과한 글자만 받는다(DTO가 경계에서 검사) */
export const parseBounds = (text: string): GeoBounds => {
  const [south, west, north, east] = text.split(',').map(Number);
  return { south, west, north, east };
};

export interface SortableSubscription {
  id: string;
  dday: number | null;
  competitionRatio: number | null;
  households: number | null;
}

/** 값이 없는 공고는 어느 정렬에서나 뒤로 보낸다 */
const nullsLast = (a: number | null, b: number | null, direction: 1 | -1): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
};

const ASCENDING = 1;
const DESCENDING = -1;

/**
 * 문자 코드 그대로 비교한다. localeCompare는 로캘이 무시하는 문자만 다른 두 id를 같다고 볼 수 있어
 * 정렬이 매번 같다는 보장이 깨진다
 */
const compareCodeUnits = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

// 값이 같으면 id로 순서를 고정한다 — 같은 조건으로 다시 불러도 페이지 경계가 흔들리지 않게
const COMPARATORS: Record<SubscriptionSort, (a: SortableSubscription, b: SortableSubscription) => number> = {
  DEADLINE: (a, b) => nullsLast(a.dday, b.dday, ASCENDING) || compareCodeUnits(a.id, b.id),
  COMPETITION: (a, b) => nullsLast(a.competitionRatio, b.competitionRatio, ASCENDING) || compareCodeUnits(a.id, b.id),
  HOUSEHOLDS: (a, b) => nullsLast(a.households, b.households, DESCENDING) || compareCodeUnits(a.id, b.id),
};

export const sortSubscriptions = <T extends SortableSubscription>(items: readonly T[], sort: SubscriptionSort): T[] =>
  [...items].sort(COMPARATORS[sort]);

/** web 통합 검색과 같은 순위 — 제목이 검색어와 같은 공고, 검색어로 시작하는 공고, 검색어를 품은 공고, 다른 필드로만 맞은 공고 순 */
const SEARCH_RANK = { SAME_TITLE: 0, TITLE_PREFIX: 1, IN_TITLE: 2, OTHER_FIELD: 3 } as const;

const searchRankOf = (title: string, keyword: string): number => {
  const name = normalizeKeyword(title) ?? '';
  if (name === keyword) return SEARCH_RANK.SAME_TITLE;
  if (name.startsWith(keyword)) return SEARCH_RANK.TITLE_PREFIX;
  if (name.includes(keyword)) return SEARCH_RANK.IN_TITLE;
  return SEARCH_RANK.OTHER_FIELD;
};

/** keyword는 normalizeKeyword를 거친 값이다. 같은 순위 안에서는 web 검색처럼 목록 기본 정렬(마감 임박순)을 따른다 */
export const sortSearchResults = <T extends SortableSubscription & { title: string }>(
  items: readonly T[],
  keyword: string,
): T[] =>
  items
    .map((item) => ({ item, rank: searchRankOf(item.title, keyword) }))
    .sort((a, b) => a.rank - b.rank || COMPARATORS[DEFAULT_SUBSCRIPTION_SORT](a.item, b.item))
    .map(({ item }) => item);
