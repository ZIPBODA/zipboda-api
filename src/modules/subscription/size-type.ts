/** ITF-003 주택형은 전용면적의 정수부다(59.98㎡ → "59"). 공고들이 같은 관례로 평형을 부른다 */
export const sizeTypeOf = (exclusiveArea: number): string => String(Math.floor(exclusiveArea));
