import type { StoredAgencyCode, StoredRegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';

/**
 * API-011 응답 data. 날짜는 YYYY-MM-DD, 입주는 YYYY-MM. 값이 없는 항목은 null이다.
 * dday·contractDate·supplyUnits·recruitCount·applicationCount·imageUrl과 도면의 층·호·전용면적은
 * web 상세 화면 기준으로 정의서보다 앞서 넣었다(docs/ZIPBODA_api-contract-delta.md)
 */
export interface SubscriptionDetailResponse {
  id: string;
  title: string;
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
  /** 첫째가 상세가 처음 보여 줄 도면이다 */
  floorplans: SubscriptionFloorplanResponse[];
}

export interface SubscriptionUnitResponse {
  size: string;
  type: string | null;
  households: number | null;
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
  has2d: boolean;
  has3d: boolean;
}
