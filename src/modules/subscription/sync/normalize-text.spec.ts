import { RegionCode } from '@/common/constants/interface-codes.js';
import {
  correctionMarksOf,
  parseArea,
  parseAreaRange,
  parseCount,
  parseDate,
  parseDateTimeRange,
  parseWon,
  parseYearMonth,
  regionOf,
  sigunguOf,
  textOrNull,
  titleKeyOf,
  unitTypeOf,
  withoutSidoPrefix,
} from './normalize-text.js';

describe('원천 표기 읽기', () => {
  it.each([
    ['2026.10.13', '2026-10-13'],
    ['20261008', '2026-10-08'],
    ['2026-10-23', '2026-10-23'],
    ['2025.11.13.', '2025-11-13'],
    ['2026.02.30', null],
    ['0000.01.01', null],
    ['공고문 참조', null],
    [null, null],
  ])('날짜 %j → %j', (text, expected) => {
    expect(parseDate(text)).toBe(expected);
  });

  it.each([
    ['2028년 07월', '2028-07'],
    ['2022년 2월', '2022-02'],
    ['2027.02', '2027-02'],
    ['202812', '2028-12'],
    ['2013.13', null],
    ['0000.01', null],
    ['미정', null],
  ])('입주 시기 %j → %j', (text, expected) => {
    expect(parseYearMonth(text)).toBe(expected);
  });

  it('접수 일시는 양쪽 날짜·시각으로 나누고, "~"뿐이면 비운다', () => {
    expect(parseDateTimeRange('2026.09.28 10:00 ~ 2026.09.30 16:10')).toEqual({
      start: { date: '2026-09-28', time: '10:00' },
      end: { date: '2026-09-30', time: '16:10' },
    });
    expect(parseDateTimeRange('2026.09.28 9:00 ~ 2026.09.28')).toEqual({
      start: { date: '2026-09-28', time: '09:00' },
      end: { date: '2026-09-28', time: null },
    });
    expect(parseDateTimeRange(textOrNull('~'))).toEqual({
      start: { date: null, time: null },
      end: { date: null, time: null },
    });
  });

  it('끝에 시각만 있으면 같은 날로 읽고, 있을 수 없는 시각은 비운다', () => {
    expect(parseDateTimeRange('2026.07.13 10:00 ~ 17:00')).toEqual({
      start: { date: '2026-07-13', time: '10:00' },
      end: { date: '2026-07-13', time: '17:00' },
    });
    expect(parseDateTimeRange('2026.07.13 25:99 ~ 2026.07.14 24:00')).toEqual({
      start: { date: '2026-07-13', time: null },
      end: { date: '2026-07-14', time: null },
    });
  });

  it('저장 열의 범위를 넘는 세대·면적·금액은 비운다', () => {
    expect(parseCount('2147483647')).toBe(2_147_483_647);
    expect(parseCount('99999999999')).toBeNull();
    expect(parseArea('99999.9999')).toBe(99_999.9999);
    expect(parseArea('123456789')).toBeNull();
    expect(parseAreaRange('10~123456789')).toBeNull();
    expect(parseWon('99999999999999999999')).toEqual({ won: null, note: '99999999999999999999' });
  });

  it('금액은 원 단위 정수로, 숫자가 아니면 원문을 안내로 돌려준다', () => {
    expect(parseWon('613425000')).toEqual({ won: 613_425_000n, note: null });
    expect(parseWon('43,906,000')).toEqual({ won: 43_906_000n, note: null });
    expect(parseWon('공고문 참조')).toEqual({ won: null, note: '공고문 참조' });
    expect(parseWon(null)).toEqual({ won: null, note: null });
  });

  it('세대 수·면적·면적 구간', () => {
    expect(parseCount('192')).toBe(192);
    expect(parseCount('1,024')).toBe(1024);
    expect(parseCount('3~4인 가구')).toBeNull();
    expect(parseArea('36.44')).toBe(36.44);
    expect(parseArea('전용59㎡')).toBe(59);
    expect(parseArea('70~80㎡')).toBeNull();
    expect(parseAreaRange('21.78~29.43')).toEqual({ min: 21.78, max: 29.43 });
    expect(parseAreaRange('61.72 ~ 84.92')).toEqual({ min: 61.72, max: 84.92 });
    expect(parseAreaRange('70~80㎡')).toEqual({ min: 70, max: 80 });
    expect(parseAreaRange('59.95')).toBeNull();
    expect(parseAreaRange('80~70㎡')).toBeNull();
  });

  it.each([
    ['59A', 'A'],
    ['61.7200A', 'A'],
    ['24.A', 'A'],
    ['16A', 'A'],
    ['36형', null],
    ['2형', null],
    [null, null],
  ])('주택형 %j의 타입 → %j', (label, expected) => {
    expect(unitTypeOf(label)).toBe(expected);
  });

  it('정정 표시는 접두어·접미어를 모두 세고, 묶음 이름에서는 떼어 공백을 정리한다', () => {
    const twice = '[정정공고][정정공고] 강서염창 통합공공임대주택 최초 입주자 모집공고';
    expect(correctionMarksOf(twice)).toBe(2);
    expect(titleKeyOf(twice)).toBe('강서염창 통합공공임대주택 최초 입주자 모집공고');
    const suffix = '[정정공고]도봉주공1단지 국민임대주택 예비입주자 모집 공고(정정공고)';
    expect(correctionMarksOf(suffix)).toBe(2);
    expect(titleKeyOf(suffix)).toBe('도봉주공1단지 국민임대주택 예비입주자 모집 공고');
    expect(titleKeyOf('도봉주공1단지 국민임대주택 예비입주자 모집 공고')).toBe(titleKeyOf(suffix));
  });

  it('지역은 주소의 첫 낱말로 정하고, 수도권 밖 시도와 시도가 아닌 글자를 가른다', () => {
    expect(regionOf('서울특별시 강동구')).toEqual({ kind: 'metro', regionCode: RegionCode.SEOUL });
    expect(regionOf('경기도 부천시 소사구 소사로148번길 58-9')).toEqual({ kind: 'metro', regionCode: RegionCode.GYEONGGI });
    expect(regionOf('인천 남동구')).toEqual({ kind: 'metro', regionCode: RegionCode.INCHEON });
    expect(regionOf('충청남도 천안시')).toEqual({ kind: 'outside' });
    expect(regionOf('서울지역본부 전세임대')).toEqual({ kind: 'unknown' });
    expect(regionOf('constructor 1')).toEqual({ kind: 'unknown' });
  });

  it('시군구는 둘째 낱말, 리츠의 시도 줄임말 붙은 시군구는 시도를 뗀다', () => {
    expect(sigunguOf('서울특별시 강동구')).toBe('강동구');
    expect(sigunguOf('서울특별시')).toBeNull();
    expect(withoutSidoPrefix('서울관악구')).toBe('관악구');
    expect(withoutSidoPrefix('경기광주시')).toBe('광주시');
    expect(withoutSidoPrefix('관악구')).toBe('관악구');
  });
});
