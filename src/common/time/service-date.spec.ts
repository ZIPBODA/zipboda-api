import { serviceDateOf } from './service-date.js';

describe('한국 날짜', () => {
  it('UTC로 전날 밤이어도 한국 날짜로 센다', () => {
    // UTC 9월 10일 15:30 = 한국 9월 11일 00:30
    expect(serviceDateOf(new Date('2026-09-10T15:30:00Z'))).toBe('2026-09-11');
    expect(serviceDateOf(new Date('2026-09-10T14:59:59Z'))).toBe('2026-09-10');
  });
});
