import { RegionCode, type StoredRegionCode } from '@/common/constants/interface-codes.js';

/** 원천이 '값 없음'을 빈 글자 대신 이렇게 적는다(접수 시각 "~", 시설 정보 "-") */
const EMPTY_MARKERS = new Set(['', '-', '~']);

const CORRECTION_PREFIX = '[정정공고]';
const CORRECTION_SUFFIX = '(정정공고)';

/** 저장 열의 범위 — 넘는 값은 원천 오류로 보고 비운다(DB가 행 전체를 거부하지 않게) */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MIN_MONTH = 1;
const MAX_MONTH = 12;
/** INTEGER */
const MAX_COUNT = 2_147_483_647;
/** DECIMAL(9,4) */
const MAX_AREA = 99_999.9999;
/** BIGINT */
export const MAX_WON = 9_223_372_036_854_775_807n;

/** 연계시스템마다 날짜를 "2026.10.13"·"20261008"·"2026-10-23"으로 적는다 */
const DATE_PATTERN = /^(\d{4})[.-]?(\d{2})[.-]?(\d{2})\.?$/;
/** 입주 시기 "2028년 07월"·"2027.02"·"202812" */
const YEAR_MONTH_PATTERN = /^(\d{4})\s*(?:년\s*|[.-])?(\d{1,2})\s*월?$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_TIME_PATTERN = /^(\S+)\s+(\d{1,2}:\d{2})$/;
const AREA_RANGE_PATTERN = /^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*㎡?$/;
const AREA_PATTERN = /^(?:전용\s*)?(\d+(?:\.\d+)?)\s*㎡?$/;
const DIGITS = /^\d+$/;

export const textOrNull = (value: string | undefined): string | null => {
  const text = (value ?? '').trim();
  return EMPTY_MARKERS.has(text) ? null : text;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const isRealDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    MIN_YEAR <= year &&
    year <= MAX_YEAR &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** 날짜 → YYYY-MM-DD. 읽지 못하면 null — 부른 쪽이 원문과 함께 경고를 남긴다 */
export const parseDate = (text: string | null): string | null => {
  const match = text?.match(DATE_PATTERN);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isRealDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
};

/** 입주 시기 → YYYY-MM */
export const parseYearMonth = (text: string | null): string | null => {
  const match = text?.match(YEAR_MONTH_PATTERN);
  if (!match) return null;
  const [year, month] = [Number(match[1]), Number(match[2])];
  const valid = MIN_YEAR <= year && year <= MAX_YEAR && MIN_MONTH <= month && month <= MAX_MONTH;
  return valid ? `${year}-${pad2(month)}` : null;
};

const parseTime = (text: string): string | null => {
  const match = text.match(TIME_PATTERN);
  if (!match) return null;
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  return hour <= MAX_HOUR && minute <= MAX_MINUTE ? `${pad2(hour)}:${pad2(minute)}` : null;
};

export interface DateTime {
  date: string | null;
  time: string | null;
}

const parseDateTime = (text: string): DateTime => {
  const match = text.match(DATE_TIME_PATTERN);
  if (match) return { date: parseDate(match[1]), time: parseTime(match[2]) };
  return { date: parseDate(text), time: parseTime(text) };
};

/**
 * 접수 일시 "2026.09.28 10:00 ~ 2026.09.30 16:10" → 양쪽 날짜·시각. "~"뿐이면 둘 다 비어 있다.
 * 끝에 시각만 있으면("2026.07.13 10:00 ~ 17:00") 같은 날 끝나는 것으로 읽는다
 */
export const parseDateTimeRange = (text: string | null): { start: DateTime; end: DateTime } => {
  const [startText = '', endText = ''] = (text ?? '').split('~').map((part) => part.trim());
  const start = parseDateTime(startText);
  const end = parseDateTime(endText);
  return { start, end: end.date === null && end.time !== null ? { ...end, date: start.date } : end };
};

export const parseCount = (text: string | null): number | null => {
  const digits = text?.replaceAll(',', '');
  if (digits === undefined || !DIGITS.test(digits)) return null;
  const count = Number(digits);
  return count <= MAX_COUNT ? count : null;
};

/** 원 단위 금액. 숫자가 아니면("공고문 참조") 금액을 비우고 원문을 안내로 돌려준다(ERD §5 규칙 10) */
export const parseWon = (text: string | null): { won: bigint | null; note: string | null } => {
  if (text === null) return { won: null, note: null };
  const digits = text.replaceAll(',', '');
  if (!DIGITS.test(digits)) return { won: null, note: text };
  const won = BigInt(digits);
  return won <= MAX_WON ? { won, note: null } : { won: null, note: text };
};

const withinArea = (area: number): number | null => (area <= MAX_AREA ? area : null);

/** 전용면적 "36.44"·"전용59㎡"·"59㎡" → ㎡ */
export const parseArea = (text: string | null): number | null => {
  const match = text?.match(AREA_PATTERN);
  return match ? withinArea(Number(match[1])) : null;
};

/** 면적 구간 "21.78~29.43"·"61.72 ~ 84.92"·"70~80㎡". 값 하나만 오면 구간이 아니다 */
export const parseAreaRange = (text: string | null): { min: number; max: number } | null => {
  const match = text?.match(AREA_RANGE_PATTERN);
  if (!match) return null;
  const [min, max] = [withinArea(Number(match[1])), withinArea(Number(match[2]))];
  return min !== null && max !== null && min <= max ? { min, max } : null;
};

/** 주택형 표기 끝의 타입 문자("59A"·"61.7200A"·"24.A" → "A"). "36형"·"2형"처럼 타입이 없으면 null */
export const unitTypeOf = (label: string | null): string | null => label?.match(/\d\.?([A-Z]+)$/)?.[1] ?? null;

const countOccurrences = (text: string, part: string): number => text.split(part).length - 1;

/** 정정 표시 개수 — 접두어 "[정정공고]"는 정정할 때마다 하나씩 붙고, 접미어 "(정정공고)"를 쓰는 공고도 있다 */
export const correctionMarksOf = (title: string): number =>
  countOccurrences(title, CORRECTION_PREFIX) + countOccurrences(title, CORRECTION_SUFFIX);

/** 정정 묶음을 찾는 이름(ERD §5 규칙 7) — 정정 표시를 떼고 공백을 정리한다 */
export const titleKeyOf = (title: string): string =>
  title.replaceAll(CORRECTION_PREFIX, ' ').replaceAll(CORRECTION_SUFFIX, ' ').trim().replace(/\s+/g, ' ');

/** 시도 17곳의 정식 이름과 줄임말. 수도권만 지역 코드가 있다 */
const SIDO: readonly { names: readonly string[]; regionCode: StoredRegionCode | null }[] = [
  { names: ['서울특별시', '서울'], regionCode: RegionCode.SEOUL },
  { names: ['인천광역시', '인천'], regionCode: RegionCode.INCHEON },
  { names: ['경기도', '경기'], regionCode: RegionCode.GYEONGGI },
  { names: ['부산광역시', '부산'], regionCode: null },
  { names: ['대구광역시', '대구'], regionCode: null },
  { names: ['광주광역시', '광주'], regionCode: null },
  { names: ['대전광역시', '대전'], regionCode: null },
  { names: ['울산광역시', '울산'], regionCode: null },
  { names: ['세종특별자치시', '세종'], regionCode: null },
  { names: ['강원특별자치도', '강원도', '강원'], regionCode: null },
  { names: ['충청북도', '충북'], regionCode: null },
  { names: ['충청남도', '충남'], regionCode: null },
  { names: ['전북특별자치도', '전라북도', '전북'], regionCode: null },
  { names: ['전라남도', '전남'], regionCode: null },
  { names: ['경상북도', '경북'], regionCode: null },
  { names: ['경상남도', '경남'], regionCode: null },
  { names: ['제주특별자치도', '제주'], regionCode: null },
];

export type RegionLookup =
  | { kind: 'metro'; regionCode: StoredRegionCode }
  | { kind: 'outside' }
  | { kind: 'unknown' };

/**
 * 주소나 '시도 시군구' 글자의 첫 낱말로 지역을 정한다. 시도 이름이 아닌 값('서울지역본부 전세임대')은 unknown —
 * 수도권 밖(outside)과 갈라야 부른 쪽이 건너뛰지 않고 조회 지역으로 둘 수 있다
 */
export const regionOf = (text: string | null): RegionLookup => {
  const first = text?.trim().split(/\s+/)[0] ?? '';
  const sido = SIDO.find((entry) => entry.names.includes(first));
  if (!sido) return { kind: 'unknown' };
  return sido.regionCode === null ? { kind: 'outside' } : { kind: 'metro', regionCode: sido.regionCode };
};

/** 리츠 매입임대의 '서울관악구'처럼 시도 줄임말이 붙은 시군구에서 시도를 뗀다 */
export const withoutSidoPrefix = (text: string): string => {
  const prefix = SIDO.flatMap((entry) => entry.names).find((name) => text.startsWith(name) && text.length > name.length);
  return prefix === undefined ? text : text.slice(prefix.length);
};

/** '서울특별시 강동구'·주소에서 시군구(둘째 낱말). 시도만 있으면 null */
export const sigunguOf = (text: string | null): string | null => text?.trim().split(/\s+/)[1] ?? null;
