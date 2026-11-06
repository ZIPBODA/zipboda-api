import { jest } from '@jest/globals';
import { LhApiClient, LhApiError } from './lh-api.client.js';

const SERVICE_KEY = 'test-key-0123456789';

const fakeFetch = (body: string, status = 200) =>
  jest.fn<(url: string, init: { signal: AbortSignal }) => Promise<Response>>(() =>
    Promise.resolve(new Response(body, { status })),
  );

const expectNoKey = (error: unknown) => {
  expect(error).toBeInstanceOf(LhApiError);
  expect(String(error)).not.toContain(SERVICE_KEY);
};

describe('LH API 클라이언트', () => {
  it('목록은 활용 가이드의 날짜 조건 이름과 쪽 크기로 묻고, dsList 행을 준다', async () => {
    const fetchFn = fakeFetch(JSON.stringify([{ dsSch: [{}] }, { dsList: [{ PAN_ID: '1', RNUM: 1 }], resHeader: [] }]));
    const client = new LhApiClient(SERVICE_KEY, fetchFn);
    const rows = await client.listNotices({ region: '11', upperType: '06', from: '20250101', to: '20261106', page: 2 });
    expect(rows).toEqual([{ PAN_ID: '1', RNUM: '1' }]);
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      serviceKey: SERVICE_KEY,
      PG_SZ: '100',
      PAGE: '2',
      CNP_CD: '11',
      UPP_AIS_TP_CD: '06',
      PAN_ST_DT: '20250101',
      PAN_ED_DT: '20261106',
    });
  });

  it('상세·공급정보는 목록 행의 재조회 코드로 묻는다', async () => {
    const fetchFn = fakeFetch('[]');
    const notice = { PAN_ID: 'P', CCR_CNNT_SYS_DS_CD: '03', SPL_INF_TP_CD: '062', UPP_AIS_TP_CD: '06', AIS_TP_CD: '07' };
    const bundle = await new LhApiClient(SERVICE_KEY, fetchFn).bundleOf(notice, '11');
    expect(bundle).toEqual({ queryRegion: '11', notice, detail: [], supply: [] });
    for (const [url] of fetchFn.mock.calls) {
      expect(new URL(url).searchParams.get('PAN_ID')).toBe('P');
      expect(new URL(url).searchParams.get('CCR_CNNT_SYS_DS_CD')).toBe('03');
    }
  });

  it('게이트웨이의 XML 오류는 오류 코드로 알리고, 인증키를 싣지 않는다', async () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    const error = await new LhApiClient(SERVICE_KEY, fakeFetch(xml))
      .listNotices({ region: '11', upperType: '06', from: '20250101', to: '20261106', page: 1 })
      .catch((caught: unknown) => caught);
    expectNoKey(error);
    expect(error).toMatchObject({ code: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' });
  });

  it('HTTP 200이어도 응답 머리가 처리 실패(SS_CODE)면 빈 본문을 믿지 않고 오류로 올린다', async () => {
    const body = JSON.stringify([{ dsSch: [{}] }, { resHeader: [{ RS_DTTM: '20261106', SS_CODE: 'N' }] }]);
    const error = await new LhApiClient(SERVICE_KEY, fakeFetch(body))
      .listNotices({ region: '11', upperType: '06', from: '20250101', to: '20261106', page: 1 })
      .catch((caught: unknown) => caught);
    expectNoKey(error);
    expect(error).toMatchObject({ code: 'LH_STATUS_N' });
  });

  it('HTTP 오류와 네트워크 오류도 주소 없이 알린다', async () => {
    const query = { region: '11', upperType: '06', from: '20250101', to: '20261106', page: 1 };
    const httpError = await new LhApiClient(SERVICE_KEY, fakeFetch('Gateway Timeout', 504))
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expectNoKey(httpError);
    expect(httpError).toMatchObject({ code: 'HTTP_504' });

    const failing = jest.fn((url: string) => Promise.reject(new TypeError(`fetch failed: ${url}`)));
    const networkError = await new LhApiClient(SERVICE_KEY, failing).listNotices(query).catch((caught: unknown) => caught);
    expectNoKey(networkError);
    expect(networkError).toMatchObject({ code: 'NETWORK' });
  });
});
