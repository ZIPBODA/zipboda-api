import type { TransformFnParams } from 'class-transformer';
import { emptyAs, emptyAsUndefined, toIntegerOr, toOptionalInteger, trimText } from './request-input.js';

const params = (value: unknown) => ({ value }) as TransformFnParams;

describe('쿼리 값 변환', () => {
  it('정수 글자만 숫자로 바꾸고, 빈 값은 조건 없음으로 본다', () => {
    expect(toOptionalInteger(params('3'))).toBe(3);
    expect(toOptionalInteger(params('-1'))).toBe(-1);
    expect(toOptionalInteger(params(''))).toBeUndefined();
  });

  it('공백·16진수·소수는 숫자로 바꾸지 않아 정수 검사에서 막힌다', () => {
    expect(toOptionalInteger(params(' '))).toBe(' ');
    expect(toOptionalInteger(params('0x3'))).toBe('0x3');
    expect(toOptionalInteger(params('1.5'))).toBe('1.5');
  });

  it('페이지처럼 기본값이 있는 값은 비면 기본값이 된다', () => {
    expect(toIntegerOr(20)(params(''))).toBe(20);
    expect(toIntegerOr(20)(params('5'))).toBe(5);
    expect(emptyAs('DEADLINE')(params(''))).toBe('DEADLINE');
    expect(emptyAs('DEADLINE')(params('HOUSEHOLDS'))).toBe('HOUSEHOLDS');
    expect(emptyAsUndefined(params(''))).toBeUndefined();
    expect(emptyAsUndefined(params('20-25'))).toBe('20-25');
  });

  it('검색어는 앞뒤 공백만 버리고, 글자가 아닌 값은 그대로 두어 문자열 검사에서 막힌다', () => {
    expect(trimText(params('  행복 주택 '))).toBe('행복 주택');
    expect(trimText(params(' \n '))).toBe('');
    expect(trimText(params(['a', 'b']))).toEqual(['a', 'b']);
  });
});
