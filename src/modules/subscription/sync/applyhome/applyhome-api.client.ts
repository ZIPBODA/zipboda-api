import {
  APPLYHOME_API_URL,
  APPLYHOME_MAX_DETAIL_PAGES,
  APPLYHOME_OPERATIONS,
  APPLYHOME_PAGE_SIZE,
  APPLYHOME_TIMEOUT_MS,
  type ApplyhomeKind,
} from './applyhome.constants.js';
import { applyhomeErrorCodeOf, applyhomeRowsOf, type ApplyhomeBundle, type ApplyhomeRow } from './applyhome-raw.js';

/** 요청 주소에 인증키가 들어 있어, 오류에는 주소·원문 대신 원인 코드만 싣는다 */
export class ApplyhomeApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplyhomeApiError';
  }
}

export interface ApplyhomeListQuery {
  kind: ApplyhomeKind;
  /** 모집공고일 범위 YYYYMMDD */
  from: string;
  to: string;
  page: number;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** 갈래마다 모집공고일을 'YYYY-MM-DD'나 'YYYYMMDD'로 적고, 조건도 같은 형식의 글자로 비교한다 */
const postDateConditionOf = (kind: ApplyhomeKind, compactDate: string): string =>
  APPLYHOME_OPERATIONS[kind].compactPostDate
    ? compactDate
    : `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;

export class ApplyhomeApiClient {
  constructor(
    private readonly serviceKey: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  /** 공고 목록 한 쪽(상세 조회가 곧 목록이다). 쪽 크기(APPLYHOME_PAGE_SIZE)보다 적게 오면 마지막 쪽이다 */
  listNotices({ kind, from, to, page }: ApplyhomeListQuery): Promise<ApplyhomeRow[]> {
    return this.request(APPLYHOME_API_URL.DETAIL, APPLYHOME_OPERATIONS[kind].detail, page, {
      'cond[RCRIT_PBLANC_DE::GTE]': postDateConditionOf(kind, from),
      'cond[RCRIT_PBLANC_DE::LTE]': postDateConditionOf(kind, to),
    });
  }

  /**
   * 상세 행 하나의 주택형·경쟁률을 받아 정규화할 묶음으로. 공고 키가 없으면 조건 없이 전체를 묻게 되어 부르지 않는다 —
   * 정규화가 상세를 읽을 수 없는 공고로 남긴다
   */
  async bundleOf(kind: ApplyhomeKind, detail: ApplyhomeRow): Promise<ApplyhomeBundle> {
    const houseManageNo = detail.HOUSE_MANAGE_NO?.trim();
    const pblancNo = detail.PBLANC_NO?.trim();
    if (!houseManageNo || !pblancNo) return { kind, detail, models: [], competitions: [] };
    const notice = { 'cond[HOUSE_MANAGE_NO::EQ]': houseManageNo, 'cond[PBLANC_NO::EQ]': pblancNo };
    const operations = APPLYHOME_OPERATIONS[kind];
    const [models, competitions] = await Promise.all([
      this.requestAll(APPLYHOME_API_URL.DETAIL, operations.model, notice),
      this.requestAll(APPLYHOME_API_URL.COMPETITION, operations.competition, notice),
    ]);
    return { kind, detail, models, competitions };
  }

  private async requestAll(baseUrl: string, operation: string, conditions: Record<string, string>) {
    const rows: ApplyhomeRow[] = [];
    for (let page = 1; page <= APPLYHOME_MAX_DETAIL_PAGES; page += 1) {
      const pageRows = await this.request(baseUrl, operation, page, conditions);
      rows.push(...pageRows);
      if (pageRows.length < APPLYHOME_PAGE_SIZE) return rows;
    }
    throw new ApplyhomeApiError(
      'PAGE_LIMIT',
      `청약홈 ${operation}이 ${APPLYHOME_MAX_DETAIL_PAGES}쪽을 넘었다 — 조건이 무시된 응답으로 본다`,
    );
  }

  private async request(
    baseUrl: string,
    operation: string,
    page: number,
    conditions: Record<string, string>,
  ): Promise<ApplyhomeRow[]> {
    const query = new URLSearchParams({
      serviceKey: this.serviceKey,
      page: String(page),
      perPage: String(APPLYHOME_PAGE_SIZE),
      ...conditions,
    });
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${baseUrl}${operation}?${query}`, {
        signal: AbortSignal.timeout(APPLYHOME_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      // 네트워크 오류 메시지에 요청 주소가 실릴 수 있어 오류 이름만 남긴다
      throw new ApplyhomeApiError(
        'NETWORK',
        `청약홈 ${operation}에 닿지 못했다(${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
    if (!response.ok) {
      throw new ApplyhomeApiError(`HTTP_${response.status}`, `청약홈 ${operation}이 ${response.status}로 응답했다`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApplyhomeApiError('NOT_JSON', `청약홈 ${operation}이 JSON이 아닌 응답을 줬다`);
    }
    const rows = applyhomeRowsOf(json);
    if (rows === null) {
      // 처리 실패를 HTTP 200과 오류 본문으로 알리면 빈 목록('마지막 쪽')으로 읽지 않게 오류로 올린다
      const code = applyhomeErrorCodeOf(json);
      throw new ApplyhomeApiError(
        code === null ? 'UNEXPECTED_BODY' : `ODCLOUD_${code}`,
        `청약홈 ${operation}이 목록(data)이 없는 응답을 줬다`,
      );
    }
    return rows;
  }
}
