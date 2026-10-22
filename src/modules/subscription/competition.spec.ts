import { competitionOf, competitionRatioOf } from './competition.js';

describe('경쟁률', () => {
  it('나누어떨어지면 소수점 없이, 아니면 한 자리로 쓰고, 공급 호수가 없으면 비운다', () => {
    expect(competitionOf(691, 1)).toBe('691:1');
    expect(competitionOf(691, 3)).toBe('230.3:1');
    expect(competitionOf(10, 0)).toBeNull();
    expect(competitionOf(null, 3)).toBeNull();
  });

  it('정렬에 쓰는 비율은 반올림하지 않은 값이다', () => {
    expect(competitionRatioOf(691, 3)).toBeCloseTo(230.333, 3);
    expect(competitionRatioOf(5, null)).toBeNull();
  });
});
