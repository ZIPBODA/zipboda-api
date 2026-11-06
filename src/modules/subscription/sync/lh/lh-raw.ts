/** LH 응답 한 행. 원천은 값을 모두 글자로 준다 */
export type LhRow = Readonly<Record<string, string>>;

/** 공고 한 건을 정규화하는 데 필요한 원천 응답 묶음 */
export interface LhNoticeBundle {
  /** 목록을 조회한 지역(CNP_CD 11·28·41) */
  queryRegion: string;
  notice: LhRow;
  detail: unknown;
  supply: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 글자·숫자 값만 남긴다 — 원천이 형식을 바꿔도 정규화가 엉뚱한 값을 글자로 읽지 않게 */
export const toLhRow = (record: Record<string, unknown>): LhRow =>
  Object.fromEntries(
    Object.entries(record).flatMap(([name, value]) => {
      if (typeof value === 'string') return [[name, value]];
      if (typeof value === 'number') return [[name, String(value)]];
      return [];
    }),
  );

/** LH 응답은 [{ dsSch }, { dsList, resHeader }]처럼 데이터셋 묶음의 배열이다. 이름별 행 목록으로 펼친다 */
export const datasetsOf = (json: unknown): ReadonlyMap<string, LhRow[]> => {
  const datasets = new Map<string, LhRow[]>();
  for (const part of Array.isArray(json) ? json : [json]) {
    if (!isRecord(part)) continue;
    for (const [name, value] of Object.entries(part)) {
      if (Array.isArray(value)) datasets.set(name, value.filter(isRecord).map(toLhRow));
    }
  }
  return datasets;
};

/** 공급정보는 유형마다 dsList01~05 중 다른 목록에 온다(열 이름 목록 dsList01Nm은 빼고) */
export const supplyRowsOf = (datasets: ReadonlyMap<string, LhRow[]>): LhRow[] =>
  [...datasets].filter(([name]) => /^dsList\d+$/.test(name)).flatMap(([, rows]) => rows);

/** 저장해 둔 원천 응답(테스트 자료·raw_payload)을 묶음으로 읽는다 */
export const lhBundleOf = (json: unknown): LhNoticeBundle => {
  if (!isRecord(json) || typeof json.queryRegion !== 'string' || !isRecord(json.notice)) {
    throw new Error('LH 공고 묶음 형식이 아닙니다(queryRegion·notice 필요)');
  }
  return { queryRegion: json.queryRegion, notice: toLhRow(json.notice), detail: json.detail, supply: json.supply };
};
