import { ApplyhomeKind } from './applyhome.constants.js';

/** 청약홈 응답 한 행. 원천은 값을 글자·숫자·null로 섞어 주지만 정규화는 글자로만 읽는다 */
export type ApplyhomeRow = Readonly<Record<string, string>>;

/** 공고 한 건을 정규화하는 데 필요한 원천 응답 묶음 */
export interface ApplyhomeBundle {
  kind: ApplyhomeKind;
  /** 상세 조회의 행 — 목록 조회가 곧 상세 조회다 */
  detail: ApplyhomeRow;
  /** 주택형별 상세 */
  models: ApplyhomeRow[];
  /** 주택형·순위·거주지역별 경쟁률(사업주체가 청약홈으로 접수받은 공고만 있다) */
  competitions: ApplyhomeRow[];
  /** 주택형별 특별공급 신청현황(APT만) */
  specialApplications: ApplyhomeRow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 글자·숫자 값만 남긴다 — null과 형식이 바뀐 값은 빈 값으로 본다 */
export const toApplyhomeRow = (record: Record<string, unknown>): ApplyhomeRow =>
  Object.fromEntries(
    Object.entries(record).flatMap(([name, value]) => {
      if (typeof value === 'string') return [[name, value]];
      if (typeof value === 'number') return [[name, String(value)]];
      return [];
    }),
  );

/** 청약홈 응답 `{ page, perPage, totalCount, data: [...] }`의 행. data 배열이 없으면 정상 응답이 아니다(null) */
export const applyhomeRowsOf = (json: unknown): ApplyhomeRow[] | null =>
  isRecord(json) && Array.isArray(json.data) ? json.data.filter(isRecord).map(toApplyhomeRow) : null;

/** 오류 응답 `{ code: -4, msg: … }`의 코드 */
export const applyhomeErrorCodeOf = (json: unknown): string | null =>
  isRecord(json) && (typeof json.code === 'number' || typeof json.code === 'string') ? String(json.code) : null;

const KINDS: readonly string[] = Object.values(ApplyhomeKind);

const isApplyhomeKind = (value: unknown): value is ApplyhomeKind => typeof value === 'string' && KINDS.includes(value);

const rowsOf = (value: unknown): ApplyhomeRow[] =>
  Array.isArray(value) ? value.filter(isRecord).map(toApplyhomeRow) : [];

/** 저장해 둔 원천 응답(테스트 자료·raw_payload)을 묶음으로 읽는다 */
export const applyhomeBundleOf = (json: unknown): ApplyhomeBundle => {
  if (!isRecord(json) || !isApplyhomeKind(json.kind) || !isRecord(json.detail)) {
    throw new Error('청약홈 공고 묶음 형식이 아닙니다(kind·detail 필요)');
  }
  return {
    kind: json.kind,
    detail: toApplyhomeRow(json.detail),
    models: rowsOf(json.models),
    competitions: rowsOf(json.competitions),
    specialApplications: rowsOf(json.specialApplications),
  };
};
