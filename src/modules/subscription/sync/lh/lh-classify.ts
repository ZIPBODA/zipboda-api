import type { SupplyCategory } from '../../constants.js';
import {
  LH_COLLECTED_TYPES,
  LH_EXCLUDED_TYPES,
  LH_OPERATOR_RECRUIT_TITLE,
  LH_PURCHASE_RENTAL_TYPE,
} from './lh.constants.js';
import type { LhRow } from './lh-raw.js';

export type LhClassification =
  | { kind: 'collect'; category: SupplyCategory }
  | { kind: 'exclude'; reason: string }
  | { kind: 'unknown'; typeKey: string };

/** 수집 분류(ERD §5 규칙 14) — 상위 유형·공급 유형 코드로 가르고, 매입임대의 운영기관 모집은 공고명으로 뺀다 */
export const classifyLhNotice = (notice: LhRow): LhClassification => {
  const typeKey = `${notice.UPP_AIS_TP_CD}-${notice.AIS_TP_CD}`;
  if (Object.hasOwn(LH_EXCLUDED_TYPES, typeKey)) return { kind: 'exclude', reason: LH_EXCLUDED_TYPES[typeKey] };
  if (!Object.hasOwn(LH_COLLECTED_TYPES, typeKey)) return { kind: 'unknown', typeKey };
  if (typeKey === LH_PURCHASE_RENTAL_TYPE && LH_OPERATOR_RECRUIT_TITLE.test(notice.PAN_NM ?? '')) {
    return { kind: 'exclude', reason: '입주자가 아니라 운영기관을 모집하는 공고' };
  }
  return { kind: 'collect', category: LH_COLLECTED_TYPES[typeKey] };
};
