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

/** API-012 지도 핀 한 개. web 지도 옆 목록이 핀마다 카드를 그려 목록 한 칸과 같은 모양이고, 좌표가 늘 있다 */
export interface SubscriptionMapMarkerResponse extends SubscriptionListItemResponse {
  lat: number;
  lng: number;
}

export interface SubscriptionMapResponse {
  markers: SubscriptionMapMarkerResponse[];
  /** 영역·좌표와 상관없이 같은 조건에 맞는 칸 수(목록 totalCount와 같다). web이 좌표가 없어 핀이 없는 공고 수를 알린다 */
  totalCount: number;
}

/** 지금 목록에 있는 칸으로 만든 필터 선택지. 눌러도 늘 0건인 선택지는 주지 않는다 */
export interface SubscriptionFilterOptionsResponse {
  regions: StoredRegionCode[];
  agencies: StoredAgencyCode[];
  statuses: SubscriptionStatusCode[];
  sizeRanges: { value: string; min: number; max: number | null }[];
}
