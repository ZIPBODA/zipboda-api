import { formatWon, unitPriceOf } from './unit-price.js';

const NO_PRICE = { depositWon: null, monthlyRentWon: null, salePriceWon: null, priceNote: null };

describe('주택형 금액', () => {
  it.each([
    [613_400_000n, '6억 1,340만 원'],
    [30_000_000n, '3,000만 원'],
    [150_000n, '15만 원'],
    [1_200_005_500n, '12억 5,500 원'],
    [5_500n, '5,500 원'],
    [0n, '0원'],
  ])('%s원 → %s', (won, expected) => {
    expect(formatWon(won)).toBe(expected);
  });

  it('보증금·월임대료·분양가 중 있는 것만 잇는다', () => {
    expect(unitPriceOf({ ...NO_PRICE, depositWon: 30_000_000n, monthlyRentWon: 150_000n })).toBe(
      '보증금 3,000만 원 · 월 15만 원',
    );
    expect(unitPriceOf({ ...NO_PRICE, salePriceWon: 613_400_000n })).toBe('분양가 6억 1,340만 원');
  });

  it('금액 대신 안내만 왔으면 원문을, 아무것도 없으면 null을 준다', () => {
    expect(unitPriceOf({ ...NO_PRICE, priceNote: '공고문 참조' })).toBe('공고문 참조');
    expect(unitPriceOf(NO_PRICE)).toBeNull();
  });
});
