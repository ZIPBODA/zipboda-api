/** 공급 호수 한 자리를 몇 명이 겨뤘는지(공공주택 공고가 쓰는 계산). 공급 호수를 모르면 비교할 수 없다 */
export const competitionRatioOf = (applicationCount: number | null, supplyUnits: number | null): number | null =>
  applicationCount === null || supplyUnits === null || supplyUnits <= 0 ? null : applicationCount / supplyUnits;

/** 나누어떨어지면 소수점을 붙이지 않는다(691.0:1 → 691:1) */
export const competitionOf = (applicationCount: number | null, supplyUnits: number | null): string | null => {
  const ratio = competitionRatioOf(applicationCount, supplyUnits);
  if (ratio === null) return null;
  return `${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}:1`;
};
