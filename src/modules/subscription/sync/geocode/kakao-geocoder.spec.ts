import { jest } from '@jest/globals';
import { GeocodeError, KakaoGeocoder } from './kakao-geocoder.js';

const REST_KEY = 'test-kakao-key-123';

const fakeFetch = (body: unknown, status = 200) =>
  jest.fn<(url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );

const geocodeOf = (body: unknown, address: string, status = 200) =>
  new KakaoGeocoder(REST_KEY, fakeFetch(body, status)).geocode(address).catch((caught: unknown) => caught);

describe('카카오 지오코딩', () => {
  it('첫 결과의 좌표를 숫자로 주고, 키는 주소가 아니라 인증 헤더에 싣는다', async () => {
    const fetchFn = fakeFetch({
      documents: [
        { x: '127.0492', y: '37.4754', address_name: '서울 강남구 논현로12길 23-5', address_type: 'ROAD_ADDR' },
      ],
    });
    const point = await new KakaoGeocoder(REST_KEY, fetchFn).geocode('서울특별시 강남구 논현로12길 23-5');
    expect(point).toEqual({ lat: 37.4754, lng: 127.0492 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url).searchParams.get('query')).toBe('서울특별시 강남구 논현로12길 23-5');
    expect(url).not.toContain(REST_KEY);
    expect(init.headers.Authorization).toBe(`KakaoAK ${REST_KEY}`);
  });

  it('결과가 없거나 좌표가 이상하면 찾지 못한 것(null)이다', async () => {
    expect(await geocodeOf({ documents: [] }, '없는 주소')).toBeNull();
    expect(await geocodeOf({ documents: [{ x: 'abc', y: '37', address_type: 'ROAD_ADDR' }] }, 'x')).toBeNull();
  });

  it('지명·도로명만 맞은 결과는 그 지역의 중심이라 찾지 못한 것으로 본다', async () => {
    for (const addressType of ['REGION', 'ROAD']) {
      const regionOnly = { documents: [{ x: '126.9', y: '37.2', address_type: addressType }] };
      expect(await geocodeOf(regionOnly, '경기도 화성시 봉담읍 일원')).toBeNull();
    }
    const jibun = { documents: [{ x: '126.6', y: '37.6', address_type: 'REGION_ADDR' }] };
    expect(await geocodeOf(jibun, '인천광역시 서구 불로동 1005-1')).toEqual({ lat: 37.6, lng: 126.6 });
  });

  it('서비스 오류는 키 없이 원인 코드로 알린다', async () => {
    const error = await geocodeOf({ message: 'unauthorized' }, '서울', 401);
    expect(error).toBeInstanceOf(GeocodeError);
    expect(error).toMatchObject({ code: 'HTTP_401' });
    expect(String(error)).not.toContain(REST_KEY);
  });

  it('호출 한도 초과(400, code -10)는 다른 400과 갈라 알린다', async () => {
    const quota = { errorType: 'BadRequest', message: 'API limit has been exceeded.', code: -10 };
    expect(await geocodeOf(quota, '서울', 400)).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(await geocodeOf({ code: -2 }, '서울', 400)).toMatchObject({ code: 'HTTP_400' });
  });
});
