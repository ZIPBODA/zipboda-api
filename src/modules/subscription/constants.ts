/** 공고 일정(접수 시작·마감·D-day)을 세는 기준 시간대 */
export const SERVICE_TIME_ZONE = 'Asia/Seoul';

/** 공고 식별자 길이 상한. 기관 공고번호가 들어와도 넉넉한 길이로, 비정상적으로 긴 경로는 검증에서 막는다 */
export const SUBSCRIPTION_ID_MAX_LENGTH = 100;

/**
 * 공고×단지 칸이 단지를 정한 방법이자 단지 별칭이 생긴 방법(ERD §5 규칙 8). 마이그레이션 CHECK와 같은 값이다.
 * ADDRESS = 주소가 같아 이음, NAME = 이름으로만 이음, MANUAL = 관리자·시드가 확인함
 */
export const ComplexMatch = { ADDRESS: 'ADDRESS', NAME: 'NAME', MANUAL: 'MANUAL' } as const;
export type ComplexMatch = (typeof ComplexMatch)[keyof typeof ComplexMatch];

/** 한 단지에 여러 칸이 모일 때 남길 연결 — 확인된 연결일수록 크다(평면도 노출이 갈린다) */
export const COMPLEX_MATCH_STRENGTH: Readonly<Record<ComplexMatch, number>> = {
  [ComplexMatch.NAME]: 0,
  [ComplexMatch.ADDRESS]: 1,
  [ComplexMatch.MANUAL]: 2,
};

/** 이름으로만 이은 단지는 같은 이름의 다른 건물일 수 있어 평면도를 보여 주지 않는다 */
export const FLOORPLAN_VISIBLE_MATCHES: readonly string[] = [ComplexMatch.ADDRESS, ComplexMatch.MANUAL];

/** 단지 좌표를 얻은 결과. 마이그레이션 CHECK와 같은 값이다 */
export const GeocodeStatus = { OK: 'OK', NOT_FOUND: 'NOT_FOUND', NO_ADDRESS: 'NO_ADDRESS', MANUAL: 'MANUAL' } as const;

/** 공고를 만든 경로 — 수집(SYNC)이나 관리자 등록(MANUAL). 마이그레이션 CHECK와 같은 값이다 */
export const NoticeOrigin = { SYNC: 'SYNC', MANUAL: 'MANUAL' } as const;

/** 공고 수집 분류(ERD §5 규칙 14). 마이그레이션 CHECK와 같은 값이다 */
export const SupplyCategory = { SALE: 'SALE', PUBLIC_RENTAL: 'PUBLIC_RENTAL', PURCHASE_RENTAL: 'PURCHASE_RENTAL' } as const;
export type SupplyCategory = (typeof SupplyCategory)[keyof typeof SupplyCategory];

/** 칸의 종류·대상별 일정(ERD §4.6). 마이그레이션 CHECK와 같은 값이다 */
export const ScheduleKind = {
  APPLY: 'APPLY',
  DOC_TARGET: 'DOC_TARGET',
  DOC_SUBMIT: 'DOC_SUBMIT',
  VIEWING: 'VIEWING',
  WINNER: 'WINNER',
  WINNER_DOC: 'WINNER_DOC',
  CONTRACT: 'CONTRACT',
} as const;
export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];

/** 동기화에서 문제가 난 단계(ERD §4.10). 마이그레이션 CHECK와 같은 값이다 */
export const SyncStage = {
  FETCH: 'FETCH',
  NORMALIZE: 'NORMALIZE',
  MATCH: 'MATCH',
  GEOCODE: 'GEOCODE',
  SAVE: 'SAVE',
} as const;
export type SyncStage = (typeof SyncStage)[keyof typeof SyncStage];

/** 공고 원천. 마이그레이션 CHECK와 같은 값이다 */
export const NoticeSourceName = {
  LH: 'LH',
  APPLYHOME: 'APPLYHOME',
  IH: 'IH',
  SH_RSS: 'SH_RSS',
  GH_FILE: 'GH_FILE',
} as const;
export type NoticeSourceName = (typeof NoticeSourceName)[keyof typeof NoticeSourceName];

/**
 * 공고 값을 정하는 원천의 순위(ERD §5 규칙 12) — 작을수록 앞선다. 기관 원천이 청약홈보다 앞서고,
 * 같은 순위끼리는 정정 표시가 많은(나중) 공고가 앞선다(규칙 7)
 */
export const PRIMARY_SOURCE_RANK: Readonly<Record<NoticeSourceName, number>> = {
  [NoticeSourceName.LH]: 0,
  [NoticeSourceName.IH]: 0,
  [NoticeSourceName.SH_RSS]: 0,
  [NoticeSourceName.GH_FILE]: 0,
  [NoticeSourceName.APPLYHOME]: 1,
};

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
