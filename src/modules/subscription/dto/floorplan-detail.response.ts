import type { SubscriptionFloorplanResponse } from './subscription-detail.response.js';

/**
 * API-031 평면도 상세. 정의서의 dimensions·rooms는 아직 저장하지 않아 주지 않는다(docs/ZIPBODA_api-contract-delta.md).
 * 평면도는 단지에 붙어 여러 공고에 나오므로, 들어갈 공고는 subscriptionId 하나로 고른다
 */
export interface FloorplanDetailResponse extends SubscriptionFloorplanResponse {
  /** 도면이 있는 단지 이름 */
  complexName: string;
  /** 이 도면을 보여 주는 목록 칸 — 목록 마감 임박순(접수 중 → 접수 예정 → 최근 마감)의 첫 칸. 보여 줄 칸이 없으면 null */
  subscriptionId: string | null;
}
