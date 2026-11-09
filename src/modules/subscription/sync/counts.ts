/** 세대·인원 합계. 모르는 값(null)은 0으로 보지 않는다 — 둘 다 모르면 합계도 모른다 */
export const addCounts = (a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
};
