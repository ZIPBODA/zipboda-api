import type { SubscriptionListItemResponse } from './subscription-list.response.js';

export interface SearchResultGroup<T> {
  items: T[];
  totalCount: number;
}

/**
 * API-095 통합 검색. 종류마다 같은 page·pageSize로 자른 항목과 맞은 전체 건수를 준다.
 * 가구(products)는 커머스(S6) 전이라 늘 비어 있다 — web 결과 화면의 '가구' 칸과 모양을 맞춰 둔다
 */
export interface SearchResponse {
  page: number;
  pageSize: number;
  subscriptions: SearchResultGroup<SubscriptionListItemResponse>;
  products: SearchResultGroup<never>;
}
