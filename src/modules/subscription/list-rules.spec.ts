import { AgencyCode, RegionCode } from '@/common/constants/interface-codes.js';
import {
  codesMatchingKeyword,
  isGeoBoundsText,
  normalizeKeyword,
  parseBounds,
  sizeRangeOf,
  sortSearchResults,
  type SearchCandidate,
} from './list-rules.js';

describe('목록 조건', () => {
  // 경계(min ≤ 면적 < max)는 SQL 조건이 정한다 — e2e '정렬·면적 경계'가 본다
  it('면적 구간 값을 구간으로 풀고, 마지막 구간은 위가 열려 있으며, 없는 값은 조건이 아니다', () => {
    expect(sizeRangeOf('20-25')).toEqual({ value: '20-25', min: 20, max: 25 });
    expect(sizeRangeOf('30-')).toEqual({ value: '30-', min: 30, max: null });
    expect(sizeRangeOf('39')).toBeUndefined();
  });

  it('검색어는 앞뒤·연속 공백을 정리하고 소문자로 맞추며, 비면 조건을 걸지 않는다', () => {
    expect(normalizeKeyword('  강남   개포 ')).toBe('강남 개포');
    expect(normalizeKeyword('LH')).toBe('lh');
    expect(normalizeKeyword('   ')).toBeNull();
    expect(normalizeKeyword(undefined)).toBeNull();
  });

  it('검색어가 기관 약칭이나 지역 이름에 들어 있으면 그 코드도 조건이 된다', () => {
    expect(codesMatchingKeyword('lh')).toEqual({ agencyCodes: [AgencyCode.LH], regionCodes: [] });
    expect(codesMatchingKeyword('서울')).toEqual({ agencyCodes: [], regionCodes: [RegionCode.SEOUL] });
    expect(codesMatchingKeyword('개포')).toEqual({ agencyCodes: [], regionCodes: [] });
  });

  it('지도 영역은 남·서·북·동 순서로 푼다', () => {
    expect(parseBounds('37.4,126.8,37.7,127.2')).toEqual({ south: 37.4, west: 126.8, north: 37.7, east: 127.2 });
    expect(parseBounds('-33.9,-70.7,-33.4,-70.5')).toEqual({ south: -33.9, west: -70.7, north: -33.4, east: -70.5 });
  });

  it.each([
    ['37.4,126.8,37.7,127.2', true],
    ['-90,-180,90,180', true],
    ['37.7,126.8,37.4,127.2', false],
    ['37.4,127.2,37.7,126.8', false],
    ['37.4,126.8,91,127.2', false],
    ['37.4,126.8,37.7,181', false],
    // 자릿수가 너무 많아 Infinity가 되는 값
    [`0,0,${'9'.repeat(400)},1`, false],
    ['37.4,126.8,37.7', false],
    ['37.4, 126.8,37.7,127.2', false],
  ])('지도 영역 %s는 %s다 — 형식·위경도 범위·남≤북·서≤동을 함께 본다', (text, expected) => {
    expect(isGeoBoundsText(text)).toBe(expected);
  });
});

describe('통합 검색 순위', () => {
  const titled = (id: string, title: string, dday: number | null = null): SearchCandidate => ({ id, title, dday });

  it('제목 일치 → 제목 앞부분 → 제목 포함 → 다른 필드 순이고, 같은 순위는 마감 임박순이다', () => {
    const results = sortSearchResults(
      [
        titled('field', '청년 주택'),
        titled('inside-late', '서울 매입임대'),
        titled('prefix', '매입임대 2차'),
        titled('inside-soon', '경기 매입임대', 2),
        titled('same', '매입임대'),
      ],
      '매입임대',
    );
    expect(results.map((item) => item.id)).toEqual(['same', 'prefix', 'inside-soon', 'inside-late', 'field']);
  });

  // DB 검색(ILIKE)이 돌려줄 수 있는 차이는 대소문자와 앞뒤 공백이다 — 순위도 이 차이를 무시해야 web과 같다
  it('제목의 앞뒤 공백·대소문자는 무시하고 순위를 매긴다', () => {
    const results = sortSearchResults(
      [titled('field', '다른 공고'), titled('prefix', 'Lh 행복주택 2차'), titled('same', '  LH 행복주택 ')],
      'lh 행복주택',
    );
    expect(results.map((item) => item.id)).toEqual(['same', 'prefix', 'field']);
  });

  // 목록 SQL이 id를 COLLATE "C"로 가르는 것과 같은 순서 — 대문자(0x42)가 소문자(0x61)보다 앞이다
  it('순위와 D-day가 같으면 id를 문자 코드 순으로 가른다', () => {
    const results = sortSearchResults([titled('e2e-a', '행복주택 1'), titled('e2e-B', '행복주택 2')], '행복');
    expect(results.map((item) => item.id)).toEqual(['e2e-B', 'e2e-a']);
  });

  // 문자열 < 비교(UTF-16)로는 이모지(U+1F600)가 전각 느낌표(U+FF01)보다 앞이지만, SQL "C"는 코드 포인트 순이라 뒤다
  it('보조 평면 문자가 섞인 id도 SQL과 같은 코드 포인트 순으로 가른다', () => {
    const results = sortSearchResults([titled('a😀', '행복주택'), titled('a！', '행복주택')], '행복');
    expect(results.map((item) => item.id)).toEqual(['a！', 'a😀']);
  });
});
