import { AgencyCode, RegionCode } from '@/common/constants/interface-codes.js';
import {
  codesMatchingKeyword,
  isGeoBoundsText,
  isInSizeRange,
  normalizeKeyword,
  parseBounds,
  sizeRangeOf,
  sortSubscriptions,
  type SortableSubscription,
} from './list-rules.js';

const entry = (id: string, values: Partial<SortableSubscription> = {}): SortableSubscription => ({
  id,
  dday: null,
  competitionRatio: null,
  households: null,
  ...values,
});

describe('목록 조건', () => {
  it('면적 구간은 왼쪽 경계만 포함하고, 마지막 구간은 위가 열려 있다', () => {
    const range = sizeRangeOf('20-25');
    expect(range).toBeDefined();
    if (!range) return;
    expect(isInSizeRange(20, range)).toBe(true);
    expect(isInSizeRange(24.99, range)).toBe(true);
    expect(isInSizeRange(25, range)).toBe(false);
    const open = sizeRangeOf('30-');
    expect(open && isInSizeRange(120, open)).toBe(true);
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

describe('목록 정렬', () => {
  const items = [
    entry('c', { dday: null, competitionRatio: 5, households: 40 }),
    entry('b', { dday: 3, competitionRatio: null, households: null }),
    entry('a', { dday: 3, competitionRatio: 230, households: 13 }),
    entry('d', { dday: 0, competitionRatio: 1.5, households: 40 }),
  ];
  const ids = (sorted: SortableSubscription[]) => sorted.map((item) => item.id);

  it('마감 임박은 D-day가 작은 순, D-day가 없는 공고는 뒤, 같으면 id 순이다', () => {
    expect(ids(sortSubscriptions(items, 'DEADLINE'))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('경쟁률은 낮은 순이고 경쟁률을 모르는 공고는 뒤다', () => {
    expect(ids(sortSubscriptions(items, 'COMPETITION'))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('세대 수는 많은 순이고 모르는 공고는 뒤다', () => {
    expect(ids(sortSubscriptions(items, 'HOUSEHOLDS'))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('원래 배열은 건드리지 않는다', () => {
    sortSubscriptions(items, 'DEADLINE');
    expect(ids(items)).toEqual(['c', 'b', 'a', 'd']);
  });
});
