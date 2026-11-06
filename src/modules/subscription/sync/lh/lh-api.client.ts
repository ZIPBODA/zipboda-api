import { LH_API_URL, LH_PAGE_SIZE, LH_SUCCESS_CODE, LH_TIMEOUT_MS } from './lh.constants.js';
import { datasetsOf, type LhNoticeBundle, type LhRow } from './lh-raw.js';

/** 요청 주소에 인증키가 들어 있어, 오류에는 주소·원문 대신 원천이 준 오류 코드만 싣는다 */
export class LhApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LhApiError';
  }
}

export interface LhListQuery {
  /** 조회 지역 CNP_CD(11·28·41) */
  region: string;
  /** 상위 유형 UPP_AIS_TP_CD(05·06·13·39) */
  upperType: string;
  /** 공고 게시일 범위 YYYYMMDD */
  from: string;
  to: string;
  page: number;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** data.go.kr은 인증 실패 등을 JSON이 아니라 XML(returnAuthMsg)로 돌려준다 */
const gatewayErrorOf = (text: string): string =>
  text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1] ?? text.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1] ?? 'UNKNOWN';

export class LhApiClient {
  constructor(
    private readonly serviceKey: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  /** 공고 목록 한 쪽. 쪽 크기(LH_PAGE_SIZE)보다 적게 오면 마지막 쪽이다 */
  async listNotices({ region, upperType, from, to, page }: LhListQuery): Promise<LhRow[]> {
    // 공공데이터포털 화면의 이름이 아니라 활용 가이드의 이름(PAN_ST_DT·PAN_ED_DT)만 날짜 조건으로 먹는다
    const json = await this.request(LH_API_URL.LIST, {
      PG_SZ: String(LH_PAGE_SIZE),
      PAGE: String(page),
      CNP_CD: region,
      UPP_AIS_TP_CD: upperType,
      PAN_ST_DT: from,
      PAN_ED_DT: to,
    });
    return datasetsOf(json).get('dsList') ?? [];
  }

  /** 목록 행 하나의 상세·공급정보를 받아 정규화할 묶음으로 */
  async bundleOf(notice: LhRow, queryRegion: string): Promise<LhNoticeBundle> {
    const params = {
      SPL_INF_TP_CD: notice.SPL_INF_TP_CD ?? '',
      CCR_CNNT_SYS_DS_CD: notice.CCR_CNNT_SYS_DS_CD ?? '',
      PAN_ID: notice.PAN_ID ?? '',
      UPP_AIS_TP_CD: notice.UPP_AIS_TP_CD ?? '',
      AIS_TP_CD: notice.AIS_TP_CD ?? '',
    };
    const [detail, supply] = await Promise.all([
      this.request(LH_API_URL.DETAIL, params),
      this.request(LH_API_URL.SUPPLY, params),
    ]);
    return { queryRegion, notice, detail, supply };
  }

  private async request(url: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ serviceKey: this.serviceKey, ...params });
    let text: string;
    let response: Response;
    try {
      response = await this.fetchFn(`${url}?${query}`, { signal: AbortSignal.timeout(LH_TIMEOUT_MS) });
      text = await response.text();
    } catch (error) {
      // 네트워크 오류 메시지에 요청 주소가 실릴 수 있어 오류 이름만 남긴다
      throw new LhApiError('NETWORK', `LH API에 닿지 못했다(${error instanceof Error ? error.name : 'unknown'})`);
    }
    if (!response.ok) throw new LhApiError(`HTTP_${response.status}`, `LH API가 ${response.status}로 응답했다`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      const code = gatewayErrorOf(text);
      throw new LhApiError(code, `LH API가 JSON이 아닌 오류 응답을 줬다(${code})`);
    }
    // 원천이 처리 실패를 HTTP 200과 응답 머리(SS_CODE)로 알리면, 빈 본문을 '단지 없음'으로 읽지 않게 오류로 올린다
    const status = datasetsOf(json).get('resHeader')?.[0]?.SS_CODE;
    if (status !== undefined && status !== LH_SUCCESS_CODE) {
      throw new LhApiError(`LH_STATUS_${status}`, `LH API가 처리 실패(SS_CODE ${status})를 알렸다`);
    }
    return json;
  }
}
