import type { StoredAgencyCode, StoredRegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';

/**
 * API-011 응답 data(목록 한 칸의 상세). 날짜는 YYYY-MM-DD, 입주는 YYYY-MM. 값이 없는 항목은 null이다.
 * noticeTitle·dday·contractDate·supplyUnits·recruitCount·applicationCount·imageUrl과 도면의 층·호·전용면적은
 * web 상세 화면 기준으로 정의서보다 앞서 넣었다(docs/ZIPBODA_api-contract-delta.md)
 */
export interface SubscriptionDetailResponse {
  id: string;
  /** 단지명. 단지 정보가 없는 공고 단위 칸은 공고명 */
  title: string;
  noticeTitle: string;
  agencyCode: StoredAgencyCode;
  agencyName: string;
  statusCode: SubscriptionStatusCode | null;
  dday: number | null;
  region: StoredRegionCode;
  address: string;
  lat: number | null;
  lng: number | null;
  postDate: string | null;
  applyStartDate: string | null;
  deadline: string | null;
  contractDate: string | null;
  supplyType: string | null;
  households: number | null;
  supplyUnits: number | null;
  recruitCount: number | null;
  applicationCount: number | null;
  moveIn: string | null;
  competition: string | null;
  imageUrl: string | null;
  units: SubscriptionUnitResponse[];
  applyUrl: string | null;
  /** 첫째가 상세가 처음 보여 줄 도면이다. 이름으로만 이은 단지의 도면은 다른 건물일 수 있어 주지 않는다 */
  floorplans: SubscriptionFloorplanResponse[];
}

/** 전용면적 오름차순(구간으로만 온 주택형은 하한) → 타입 → 호수 순이다 */
export interface SubscriptionUnitResponse {
  /** ITF-003 주택형. 전용면적이 구간으로만 왔으면 null */
  size: string | null;
  type: string | null;
  /** 원천 표기("59A"·"70~80㎡"·"2형") */
  label: string | null;
  floor: string | null;
  unitNumber: string | null;
  /** 전용면적(㎡). 구간으로만 왔으면 null — size(주택형)는 반올림한 이름이라 web이 면적을 보일 때는 이 값을 쓴다 */
  exclusiveArea: number | null;
  /** 이번 공급 세대(없으면 총세대) */
  households: number | null;
  /** 보증금·월임대료·분양가를 읽은 한 줄, 금액 대신 안내만 왔으면 그 원문 */
  price: string | null;
}

export interface SubscriptionFloorplanResponse {
  id: string;
  size: string | null;
  type: string | null;
  floor: string | null;
  unitNumber: string | null;
  /** 전용면적(㎡) */
  exclusiveArea: number | null;
  /** 2D 도면 이미지 주소. has2d가 false면 null */
  image2dUrl: string | null;
  has2d: boolean;
  has3d: boolean;
}
