import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AgencyCode, RegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SUBSCRIPTION_SORT,
  KEYWORD_MAX_LENGTH,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  SIZE_RANGE_VALUES,
  SUBSCRIPTION_SORTS,
  type SubscriptionSort,
} from '../constants.js';
import {
  IsGeoBoundsText,
  IsWithoutNul,
  emptyAs,
  emptyAsUndefined,
  toIntegerOr,
  toOptionalInteger,
} from './request-input.js';

const codesOf = (codes: Record<string, string | number>): number[] =>
  Object.values(codes).filter((value): value is number => typeof value === 'number');

/** 목록(API-010)과 지도(API-012)가 함께 쓰는 조건. 0이나 빈 값은 '전체'로 조건을 걸지 않는다 */
export class SubscriptionFilterQuery {
  /** ITF-004 */
  @IsOptional()
  @Transform(toOptionalInteger)
  @IsInt()
  @IsIn(codesOf(RegionCode))
  region?: RegionCode;

  /** ITF-001 */
  @IsOptional()
  @Transform(toOptionalInteger)
  @IsInt()
  @IsIn(codesOf(AgencyCode))
  agency?: AgencyCode;

  /** ITF-002 */
  @IsOptional()
  @Transform(toOptionalInteger)
  @IsInt()
  @IsIn(codesOf(SubscriptionStatusCode))
  status?: SubscriptionStatusCode;

  /** 전용면적 구간(예: "20-25", "30-") */
  @IsOptional()
  @Transform(emptyAsUndefined)
  @IsIn(SIZE_RANGE_VALUES)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(KEYWORD_MAX_LENGTH)
  @IsWithoutNul()
  keyword?: string;
}

/** 목록과 지도가 같은 정렬을 쓴다 — web 지도 옆 목록이 핀을 받은 순서대로 카드로 그리고, 같은 '결과 정렬'을 단다 */
class SubscriptionSortedQuery extends SubscriptionFilterQuery {
  @IsOptional()
  @Transform(emptyAs(DEFAULT_SUBSCRIPTION_SORT))
  @IsIn(SUBSCRIPTION_SORTS)
  sort: SubscriptionSort = DEFAULT_SUBSCRIPTION_SORT;
}

export class SubscriptionListQuery extends SubscriptionSortedQuery {
  @IsOptional()
  @Transform(toIntegerOr(1))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @IsOptional()
  @Transform(toIntegerOr(DEFAULT_PAGE_SIZE))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}

/** 지도 영역 "남,서,북,동"(위도·경도). 없으면 영역 조건을 걸지 않는다 */
export class SubscriptionMapQuery extends SubscriptionSortedQuery {
  @IsOptional()
  @Transform(emptyAsUndefined)
  @IsGeoBoundsText()
  bounds?: string;
}
