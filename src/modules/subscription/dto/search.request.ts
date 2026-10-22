import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, KEYWORD_MAX_LENGTH, MAX_PAGE, MAX_PAGE_SIZE } from '../constants.js';
import { IsWithoutNul, toIntegerOr, trimText } from './request-input.js';

/**
 * API-095 통합 검색. 정의서의 type(결과 종류 거르기)은 web이 쓰지 않아 받지 않는다.
 * web 결과 화면은 맞은 공고를 모두 보여 주므로 목록과 같은 방식으로 페이지를 나눠 끝까지 받을 수 있게 한다
 */
export class SearchQuery {
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(KEYWORD_MAX_LENGTH)
  @IsWithoutNul()
  q: string;

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
