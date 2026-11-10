const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_TIMEOUT_MS = 10_000;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/** 카카오는 호출 한도 초과를 HTTP 400과 본문 code -10으로 알린다 */
const KAKAO_QUOTA_EXCEEDED_CODE = -10;
export const GEOCODE_QUOTA_EXCEEDED = 'QUOTA_EXCEEDED';

/** 지명·도로명만 맞은 결과(REGION·ROAD)는 그 지역의 중심 좌표라 단지 위치로 쓰지 않는다 */
const PRECISE_ADDRESS_TYPES: readonly unknown[] = ['REGION_ADDR', 'ROAD_ADDR'];

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Geocoder {
  /** 주소 하나의 좌표. 찾지 못하면 null, 서비스 오류면 GeocodeError */
  geocode(address: string): Promise<GeoPoint | null>;
}

/** 인증 헤더의 키를 싣지 않고 원인 코드만 알린다 */
export class GeocodeError extends Error {
  constructor(readonly code: string) {
    super(`지오코딩 실패(${code})`);
    this.name = 'GeocodeError';
  }
}

type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** 카카오는 좌표를 글자("127.04")로 준다. 범위 밖이나 숫자가 아니면 찾지 못한 것으로 본다 */
const pointOf = (document: unknown): GeoPoint | null => {
  if (!isRecord(document) || !PRECISE_ADDRESS_TYPES.includes(document.address_type)) return null;
  const lng = Number(document.x);
  const lat = Number(document.y);
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= MAX_LATITUDE && Math.abs(lng) <= MAX_LONGITUDE;
  return valid ? { lat, lng } : null;
};

/** 카카오 로컬 주소 검색(REST). 키는 서버 .env에만 둔다(NEXT_PUBLIC_으로 내보내지 않는다) */
export class KakaoGeocoder implements Geocoder {
  constructor(
    private readonly restKey: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  async geocode(address: string): Promise<GeoPoint | null> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${KAKAO_ADDRESS_URL}?${new URLSearchParams({ query: address, size: '1' })}`, {
        headers: { Authorization: `KakaoAK ${this.restKey}` },
        signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw new GeocodeError(`NETWORK_${error instanceof Error ? error.name : 'unknown'}`);
    }
    const json = jsonOf(text);
    if (!response.ok) {
      const quotaExceeded = isRecord(json) && json.code === KAKAO_QUOTA_EXCEEDED_CODE;
      throw new GeocodeError(quotaExceeded ? GEOCODE_QUOTA_EXCEEDED : `HTTP_${response.status}`);
    }
    const documents = isRecord(json) && Array.isArray(json.documents) ? json.documents : [];
    return documents.length === 0 ? null : pointOf(documents[0]);
  }
}
