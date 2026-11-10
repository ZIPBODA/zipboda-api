import { jest } from '@jest/globals';
import { ApplyhomeApiClient, ApplyhomeApiError } from './applyhome-api.client.js';

const SERVICE_KEY = 'test-key-0123456789';

type FetchMock = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

const fakeFetch = (body: string, status = 200) =>
  jest.fn<FetchMock>(() => Promise.resolve(new Response(body, { status })));

const page = (data: unknown[]) => JSON.stringify({ page: 1, perPage: 500, totalCount: data.length, data });

const queryOf = (url: string) => Object.fromEntries(new URL(url).searchParams);

const expectNoKey = (error: unknown) => {
  expect(error).toBeInstanceOf(ApplyhomeApiError);
  expect(String(error)).not.toContain(SERVICE_KEY);
};

describe('청약홈 API 클라이언트', () => {
  it('목록은 갈래의 상세 오퍼레이션에 모집공고일 범위를 걸고, 숫자·null 값을 글자로 읽는다', async () => {
    const fetchFn = fakeFetch(page([{ HOUSE_MANAGE_NO: '2026000531', TOT_SUPLY_HSHLDCO: 300, SUPLY_AR: null }]));
    const rows = await new ApplyhomeApiClient(SERVICE_KEY, fetchFn).listNotices({
      kind: 'APT',
      from: '20251101',
      to: '20261110',
      page: 2,
    });
    expect(rows).toEqual([{ HOUSE_MANAGE_NO: '2026000531', TOT_SUPLY_HSHLDCO: '300' }]);
    const [url] = fetchFn.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail');
    expect(queryOf(url)).toEqual({
      serviceKey: SERVICE_KEY,
      page: '2',
      perPage: '500',
      'cond[RCRIT_PBLANC_DE::GTE]': '2025-11-01',
      'cond[RCRIT_PBLANC_DE::LTE]': '2026-11-10',
    });
  });

  it('임의공급·공공지원 민간임대는 모집공고일을 YYYYMMDD로 적어 조건도 그 형식으로 건다', async () => {
    const fetchFn = fakeFetch(page([]));
    await new ApplyhomeApiClient(SERVICE_KEY, fetchFn).listNotices({
      kind: 'OPT',
      from: '20251101',
      to: '20261110',
      page: 1,
    });
    expect(queryOf(fetchFn.mock.calls[0][0])).toMatchObject({
      'cond[RCRIT_PBLANC_DE::GTE]': '20251101',
      'cond[RCRIT_PBLANC_DE::LTE]': '20261110',
    });
  });

  it('주택형·경쟁률은 공고의 주택관리번호·공고번호로 묻는다', async () => {
    const fetchFn = jest.fn<FetchMock>((url) =>
      Promise.resolve(new Response(page(url.includes('Cmpet') ? [{ REQ_CNT: '38' }] : [{ HOUSE_TY: '074.5900A' }]))),
    );
    const detail = { HOUSE_MANAGE_NO: '2026940191', PBLANC_NO: '2026940191' };
    const bundle = await new ApplyhomeApiClient(SERVICE_KEY, fetchFn).bundleOf('OPT', detail);
    expect(bundle).toEqual({
      kind: 'OPT',
      detail,
      models: [{ HOUSE_TY: '074.5900A' }],
      competitions: [{ REQ_CNT: '38' }],
    });
    const paths = fetchFn.mock.calls.map(([url]) => new URL(url).pathname).sort();
    expect(paths).toEqual([
      '/api/ApplyhomeInfoCmpetRtSvc/v1/getOPTLttotPblancCmpet',
      '/api/ApplyhomeInfoDetailSvc/v1/getOPTLttotPblancMdl',
    ]);
    for (const [url] of fetchFn.mock.calls) {
      expect(queryOf(url)).toMatchObject({
        'cond[HOUSE_MANAGE_NO::EQ]': '2026940191',
        'cond[PBLANC_NO::EQ]': '2026940191',
      });
    }
  });

  it('HTTP 오류·JSON이 아닌 응답·네트워크 오류는 주소 없이 원인 코드로 알린다', async () => {
    const query = { kind: 'APT', from: '20251101', to: '20261110', page: 1 } as const;
    const unauthorized = await new ApplyhomeApiClient(SERVICE_KEY, fakeFetch('{"code":-4}', 401))
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expectNoKey(unauthorized);
    expect(unauthorized).toMatchObject({ code: 'HTTP_401' });

    const html = await new ApplyhomeApiClient(SERVICE_KEY, fakeFetch('<html>점검 중</html>'))
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expectNoKey(html);
    expect(html).toMatchObject({ code: 'NOT_JSON' });

    const failing = jest.fn((url: string) => Promise.reject(new TypeError(`fetch failed: ${url}`)));
    const network = await new ApplyhomeApiClient(SERVICE_KEY, failing)
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expectNoKey(network);
    expect(network).toMatchObject({ code: 'NETWORK' });
  });

  it('HTTP 200이어도 목록(data)이 없는 응답은 빈 목록이 아니라 오류다 — 오류 본문의 코드를 싣는다', async () => {
    const query = { kind: 'APT', from: '20251101', to: '20261110', page: 1 } as const;
    const coded = await new ApplyhomeApiClient(SERVICE_KEY, fakeFetch('{"code":-401,"msg":"유효하지 않은 키"}'))
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expectNoKey(coded);
    expect(coded).toMatchObject({ code: 'ODCLOUD_-401' });

    const bare = await new ApplyhomeApiClient(SERVICE_KEY, fakeFetch('{"page":1}'))
      .listNotices(query)
      .catch((caught: unknown) => caught);
    expect(bare).toMatchObject({ code: 'UNEXPECTED_BODY' });
  });

  it('주택형이 한 쪽을 넘으면 다음 쪽까지 받고, 쪽 상한을 넘기면 조건이 무시된 응답으로 보고 멈춘다', async () => {
    const fullPage = page(Array.from({ length: 500 }, (_, index) => ({ MODEL_NO: String(index) })));
    const twoPages = jest.fn<FetchMock>((url) =>
      Promise.resolve(
        new Response(new URL(url).searchParams.get('page') === '1' ? fullPage : page([{ MODEL_NO: 'x' }])),
      ),
    );
    const detail = { HOUSE_MANAGE_NO: '2026000437', PBLANC_NO: '2026000437' };
    const bundle = await new ApplyhomeApiClient(SERVICE_KEY, twoPages).bundleOf('APT', detail);
    expect(bundle.models).toHaveLength(501);

    const endless = jest.fn<FetchMock>(() => Promise.resolve(new Response(fullPage)));
    const error = await new ApplyhomeApiClient(SERVICE_KEY, endless)
      .bundleOf('APT', detail)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'PAGE_LIMIT' });
  });

  it('공고 키가 없으면 조건 없이 전체를 묻지 않게 부르지 않는다', async () => {
    const fetchFn = fakeFetch(page([]));
    const bundle = await new ApplyhomeApiClient(SERVICE_KEY, fetchFn).bundleOf('APT', { HOUSE_NM: '키 없는 공고' });
    expect(bundle).toEqual({ kind: 'APT', detail: { HOUSE_NM: '키 없는 공고' }, models: [], competitions: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
