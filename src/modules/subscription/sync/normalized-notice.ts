import type { StoredAgencyCode, StoredRegionCode } from '@/common/constants/interface-codes.js';
import type { NoticeSourceName, ScheduleKind, SupplyCategory, SyncStage } from '../constants.js';

/**
 * 원천(LH·청약홈 등)과 상관없는 정규화 결과 — 저장 단계(PR 2b)는 이 모양만 안다.
 * 날짜는 YYYY-MM-DD, 월은 YYYY-MM, 시각은 HH:MM(한국 시간), 금액은 원 단위 정수다
 */

/** 공고는 저장하되 일부 값을 비우거나 추정한 사정. sync_failures에 WARNING으로 남는다 */
export interface NormalizationWarning {
  stage: SyncStage;
  code: string;
  message: string;
}

/** 정규화하면서 만난 사정을 모은다 */
export type Warn = (stage: SyncStage, code: string, message: string) => void;

export interface NormalizedSchedule {
  kind: ScheduleKind;
  /** 대상·순위(특별공급·무순위 등). 원천이 대상을 나누지 않으면 null */
  label: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
}

export interface NormalizedUnit {
  label: string | null;
  sizeType: string | null;
  unitType: string | null;
  exclusiveArea: number | null;
  areaMin: number | null;
  areaMax: number | null;
  supplyArea: number | null;
  unitNumber: string | null;
  floorLabel: string | null;
  totalHouseholds: number | null;
  supplyHouseholds: number | null;
  recruitCount: number | null;
  depositWon: bigint | null;
  monthlyRentWon: bigint | null;
  salePriceWon: bigint | null;
  priceNote: string | null;
  note: string | null;
}

export interface NormalizedComplex {
  name: string;
  nameKey: string;
  /** 원천이 준 이름으로 별칭을 남겨도 되는지 — 지역만 적은 일반명이나 주소에서 지어낸 이름은 남기지 않는다(ERD §5 규칙 8) */
  aliasable: boolean;
  sigungu: string | null;
  address: string | null;
  addressKey: string | null;
  households: number | null;
  areaMin: number | null;
  areaMax: number | null;
  imageUrl: string | null;
}

/** 대상별 일정에서 뽑은 칸의 요약 날짜(ERD §5 규칙 2) */
export interface ListingSummary {
  applyStartDate: string | null;
  applyEndDate: string | null;
  winnerDate: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
}

/** 목록 한 칸. complex가 null이면 단지 정보가 없는 공고 단위 칸이다 */
export interface NormalizedListing {
  complex: NormalizedComplex | null;
  regionCode: StoredRegionCode;
  moveInMonth: string | null;
  supplyUnits: number | null;
  recruitCount: number | null;
  supplyNote: string | null;
  schedules: NormalizedSchedule[];
  units: NormalizedUnit[];
  summary: ListingSummary;
}

export interface NoticeAttachment {
  name: string;
  url: string;
  kind: string | null;
}

export interface NormalizedNotice {
  source: NoticeSourceName;
  sourceKey: string;
  sourceParams: Record<string, string>;
  agencyCode: StoredAgencyCode;
  title: string;
  titleKey: string;
  /** 정정 표시 개수 — 정정 묶음에서 가장 나중 공고를 고른다(ERD §5 규칙 7) */
  correctionMarks: number;
  supplyCategory: SupplyCategory;
  supplyType: string | null;
  postDate: string | null;
  applyUrl: string | null;
  sourceStatus: string | null;
  attachments: NoticeAttachment[];
  listings: NormalizedListing[];
  warnings: NormalizationWarning[];
}

/**
 * 수집 범위 밖(전세임대·운영기관 모집 등)은 저장하지 않고, 분류표에 없는 유형은 경고를 남겨 표를 늘린다.
 * invalid는 원천 응답이 비어 읽을 수 없는 공고다 — 이대로 저장하면 기존 칸을 지우게 되어 오류로 남기고 건드리지 않는다
 */
export type NormalizeResult =
  | { kind: 'notice'; notice: NormalizedNotice }
  | { kind: 'excluded'; reason: string; warnings: NormalizationWarning[] }
  | { kind: 'unclassified'; warning: NormalizationWarning }
  | { kind: 'invalid'; warning: NormalizationWarning };
