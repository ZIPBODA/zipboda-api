import type { StoredAgencyCode, StoredRegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';

/** API-011 응답 data. 날짜는 YYYY-MM-DD, 입주는 YYYY-MM. 값이 없는 항목은 null이다 */
export interface SubscriptionDetailResponse {
  id: string;
  title: string;
  agencyCode: StoredAgencyCode;
  agencyName: string;
  statusCode: SubscriptionStatusCode | null;
  region: StoredRegionCode;
  address: string;
  lat: number | null;
  lng: number | null;
  postDate: string | null;
  applyStartDate: string | null;
  deadline: string | null;
  supplyType: string | null;
  households: number | null;
  moveIn: string | null;
  competition: string | null;
  units: SubscriptionUnitResponse[];
  applyUrl: string | null;
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
  has2d: boolean;
  has3d: boolean;
}
