import type { TransformFnParams } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isGeoBoundsText } from '../list-rules.js';

const INTEGER_TEXT = /^-?\d+$/;
const NUL = '\u0000';

/** 빈 값(`?region=`)은 조건을 걸지 않은 것으로 본다 */
export const emptyAsUndefined = ({ value }: TransformFnParams): unknown => {
  const raw: unknown = value;
  return raw === '' ? undefined : raw;
};

export const emptyAs =
  (fallback: unknown) =>
  ({ value }: TransformFnParams): unknown => {
    const raw: unknown = value;
    return raw === '' ? fallback : raw;
  };

/**
 * 정수 글자만 숫자로 바꾼다. Number()에 그냥 맡기면 공백은 0(전체), "0x3"은 3이 되어 잘못된 값이 조건으로 통과한다.
 * 정수가 아니면 글자 그대로 두어 IsInt가 막게 한다
 */
export const toOptionalInteger = ({ value }: TransformFnParams): unknown => {
  const raw: unknown = value;
  if (raw === '') return undefined;
  if (typeof raw === 'string' && INTEGER_TEXT.test(raw)) return Number(raw);
  return raw;
};

export const toIntegerOr =
  (fallback: number) =>
  ({ value }: TransformFnParams): unknown => {
    const raw: unknown = value;
    if (raw === '') return fallback;
    if (typeof raw === 'string' && INTEGER_TEXT.test(raw)) return Number(raw);
    return raw;
  };

/** PostgreSQL 문자열은 NUL을 담지 못해 그대로 넘기면 DB 오류(500)가 난다 — 입력에서 유효성 오류로 막는다 */
export const IsWithoutNul = (options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    { name: 'isWithoutNul', validator: { validate: (value) => typeof value === 'string' && !value.includes(NUL) } },
    options,
  );

/** 지도 영역 "남,서,북,동" — 형식·위경도 범위·남≤북·서≤동을 경계에서 함께 본다 */
export const IsGeoBoundsText = (options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isGeoBoundsText',
      validator: { validate: (value) => typeof value === 'string' && isGeoBoundsText(value) },
    },
    options,
  );
