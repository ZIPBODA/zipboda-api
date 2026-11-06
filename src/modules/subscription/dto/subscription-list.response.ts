import type { StoredAgencyCode, StoredRegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';

/**
 * API-010 목록 한 칸(공고 × 단지). title은 단지명(공고 단위 칸은 공고명), noticeTitle은 공고명이다.
 * sizes는 주택형과 보여 주는 평면도의 전용면적(㎡, 오름차순·중복 없음)이다
 */
export interface SubscriptionListItemResponse {
  id: string;
  title: string;
  noticeTitle: string;
  agencyCode: StoredAgencyCode;
  region: StoredRegionCode;
  address: string;
  lat: number | null;
  lng: number | null;
  supplyType: string | null;
  sizes: number[];
  households: number | null;
  applicationCount: number | null;
  competition: string | null;
  moveIn: string | null;
  deadline: string | null;
  dday: number | null;
  statusCode: SubscriptionStatusCode | null;
  imageUrl: string | null;
}

export interface SubscriptionListResponse {
  items: SubscriptionListItemResponse[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** API-012 지도 핀 한 개. 이름표에 쓰도록 목록과 같은 이름(단지명)을 함께 준다 */
export interface SubscriptionMapMarkerResponse {
  id: string;
  title: string;
  lat: number;
  lng: number;
  dday: number | null;
  agencyCode: StoredAgencyCode;
  statusCode: SubscriptionStatusCode | null;
}

export interface SubscriptionMapResponse {
  markers: SubscriptionMapMarkerResponse[];
}

/** 지금 목록에 있는 칸으로 만든 필터 선택지. 눌러도 늘 0건인 선택지는 주지 않는다 */
export interface SubscriptionFilterOptionsResponse {
  regions: StoredRegionCode[];
  agencies: StoredAgencyCode[];
  statuses: SubscriptionStatusCode[];
  sizeRanges: { value: string; min: number; max: number | null }[];
}
