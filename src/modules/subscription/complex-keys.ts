/** 건물 본번-부번. 지번은 '산'이 앞에, '번지'가 뒤에 붙기도 한다. 블록 주소('A83블록')에는 없다 */
const BUILDING_NUMBER = /^산?\d+(-\d+)?(번지)?$/;

/** 시도·시군구 다음부터 번호가 나온다 — 그 앞의 숫자는 번지가 아니다 */
const FIRST_BUILDING_NUMBER_INDEX = 2;

/** 같은 이름 판별 키(ERD §5 규칙 8). '강서화곡동'과 '강서화곡동(…)'처럼 앞부분만 같은 이름이 있어 완전히 같을 때만 같은 이름이다 */
export const nameKeyOf = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** 괄호 앞까지를 공백·쉼표로 나눈다. 지번의 '산 12'는 '산12'와 같은 키가 되게 붙인다 */
const addressTokensOf = (address: string): string[] =>
  address
    .split('(')[0]
    .split(/[\s,]+/)
    .filter(Boolean)
    .reduce<string[]>((tokens, token) => {
      if (tokens.at(-1) === '산' && /^\d/.test(token)) tokens[tokens.length - 1] = `산${token}`;
      else tokens.push(token);
      return tokens;
    }, []);

/**
 * 같은 단지 판별 키(ERD §5 규칙 8) — 시도·시군구·도로명(또는 법정동)·건물 번호까지만 남긴다.
 * 원천마다 뒤에 붙는 괄호 참고 항목·'일원'·건물 이름·동·호가 달라 같은 단지가 다른 주소로 보이지 않게 한다.
 * 번호를 찾지 못하는 주소(블록 주소 등)는 판별하지 않는다
 */
export const addressKeyOf = (address: string): string | null => {
  const tokens = addressTokensOf(address);
  const numberIndex = tokens.findIndex(
    (token, index) => index >= FIRST_BUILDING_NUMBER_INDEX && BUILDING_NUMBER.test(token),
  );
  if (numberIndex < 0) return null;
  return [...tokens.slice(0, numberIndex), tokens[numberIndex].replace(/번지$/, '')].join(' ');
};
