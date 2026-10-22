import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import { competitionOf, daysBetween, serviceDateOf, statusCodeOf } from './schedule.js';
import { sizeTypeOf } from './size-type.js';

const schedule = { applyStartDate: '2026-09-07', applyEndDate: '2026-09-11', cancelled: false };

describe('공고 일정 계산', () => {
  it('UTC로 전날 밤이어도 한국 날짜로 센다', () => {
    // UTC 9월 10일 15:30 = 한국 9월 11일 00:30
    expect(serviceDateOf(new Date('2026-09-10T15:30:00Z'))).toBe('2026-09-11');
    expect(serviceDateOf(new Date('2026-09-10T14:59:59Z'))).toBe('2026-09-10');
  });

  it('남은 날은 같은 날 0, 지나면 음수다', () => {
    expect(daysBetween('2026-09-11', '2026-09-11')).toBe(0);
    expect(daysBetween('2026-09-08', '2026-09-11')).toBe(3);
    expect(daysBetween('2026-09-12', '2026-09-11')).toBe(-1);
  });

  it.each([
    ['2026-09-06', SubscriptionStatusCode.UPCOMING],
    ['2026-09-07', SubscriptionStatusCode.OPEN],
    ['2026-09-11', SubscriptionStatusCode.OPEN],
    ['2026-09-12', SubscriptionStatusCode.CLOSED],
  ])('%s에는 상태가 %s다', (today, expected) => {
    expect(statusCodeOf(schedule, today)).toBe(expected);
  });

  it('취소된 공고는 일정과 상관없이 취소이고, 일정이 없으면 상태를 지어내지 않는다', () => {
    expect(statusCodeOf({ ...schedule, cancelled: true }, '2026-09-08')).toBe(SubscriptionStatusCode.CANCELLED);
    expect(
      statusCodeOf({ applyStartDate: null, applyEndDate: '2026-09-11', cancelled: false }, '2026-09-08'),
    ).toBeNull();
  });

  it('주택형은 전용면적의 정수부다', () => {
    expect(sizeTypeOf(59.98)).toBe('59');
    expect(sizeTypeOf(84)).toBe('84');
    expect(sizeTypeOf(13.66)).toBe('13');
  });

  it('경쟁률은 나누어떨어지면 소수점 없이, 아니면 한 자리로 쓰고, 공급 호수가 없으면 비운다', () => {
    expect(competitionOf(691, 1)).toBe('691:1');
    expect(competitionOf(691, 3)).toBe('230.3:1');
    expect(competitionOf(10, 0)).toBeNull();
    expect(competitionOf(null, 3)).toBeNull();
  });
});
