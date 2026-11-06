const WON_PER_EOK = 100_000_000n;
const WON_PER_MAN = 10_000n;

const grouped = (value: bigint): string => value.toLocaleString('ko-KR');

/** 공고문처럼 억·만 단위로 읽는다(613,400,000 → "6억 1,340만 원", 150,000 → "15만 원") */
export const formatWon = (won: bigint): string => {
  const eok = won / WON_PER_EOK;
  const man = (won % WON_PER_EOK) / WON_PER_MAN;
  const rest = won % WON_PER_MAN;
  const parts = [eok > 0n ? `${grouped(eok)}억` : '', man > 0n ? `${grouped(man)}만` : '', rest > 0n ? grouped(rest) : ''];
  const text = parts.filter(Boolean).join(' ');
  return text ? `${text} 원` : '0원';
};

export interface UnitPriceFields {
  depositWon: bigint | null;
  monthlyRentWon: bigint | null;
  salePriceWon: bigint | null;
  priceNote: string | null;
}

/** 금액을 원 단위 정수로 받아 한 줄로 읽는다. 숫자가 아닌 안내("공고문 참조")만 왔으면 그 원문을 준다 */
export const unitPriceOf = ({ depositWon, monthlyRentWon, salePriceWon, priceNote }: UnitPriceFields): string | null => {
  const parts = [
    salePriceWon === null ? null : `분양가 ${formatWon(salePriceWon)}`,
    depositWon === null ? null : `보증금 ${formatWon(depositWon)}`,
    monthlyRentWon === null ? null : `월 ${formatWon(monthlyRentWon)}`,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(' · ') : priceNote;
};
