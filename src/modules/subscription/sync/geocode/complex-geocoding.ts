import type { PrismaClient } from '@/database/generated/client.js';
import { GeocodeStatus } from '../../constants.js';
import { GEOCODE_QUOTA_EXCEEDED, GeocodeError, type Geocoder, type GeoPoint } from './kakao-geocoder.js';

/** 키가 틀렸거나 호출 한도를 넘으면 남은 단지도 모두 실패한다 — 호출을 더 쓰지 않고 멈춘다 */
const GEOCODE_STOP_CODES: readonly string[] = ['HTTP_401', 'HTTP_403', 'HTTP_429', GEOCODE_QUOTA_EXCEEDED];

/** 서비스 장애로 연달아 실패하면 남은 단지마다 경고를 쌓지 않고 멈춘다 */
const MAX_CONSECUTIVE_FAILURES = 5;

export const GeocodeStopReason = {
  CONSECUTIVE_FAILURES: 'CONSECUTIVE_FAILURES',
  TIME_BUDGET: 'TIME_BUDGET',
} as const;

export interface GeocodingOptions {
  limit: number;
  /** 실행 시간 한도를 넘으면 남은 단지는 다음 실행에 넘긴다 */
  shouldStop: () => boolean;
}

export interface GeocodingResult {
  geocoded: number;
  notFound: number;
  /** 이번에 좌표를 얻었거나 주소로 못 찾는다고 판정한 단지 — 지난 실행의 지오코딩 경고를 닫는다 */
  settledIds: string[];
  /** 서비스 오류로 좌표를 얻지 못한 단지 — 지오코딩 대기(null)로 남겨 다음 실행이 다시 시도한다 */
  failures: { complexId: string; code: string }[];
  /** 남은 단지를 두고 멈춘 까닭(한도 초과 등의 오류 코드, 연속 실패, 시간 한도). 끝까지 했으면 null */
  stoppedBy: string | null;
}

/**
 * 주소는 있는데 아직 좌표를 얻지 않은 단지(geocode_status가 null)의 좌표를 채운다. 판별 키(정리한 도로명 주소)로 먼저 찾고,
 * 못 찾으면 원문 주소로 한 번 더 찾는다. 관리자가 고친 좌표(MANUAL)나 이미 판정한 단지는 건드리지 않는다
 */
export const geocodePendingComplexes = async (
  prisma: PrismaClient,
  geocoder: Geocoder,
  { limit, shouldStop }: GeocodingOptions,
): Promise<GeocodingResult> => {
  const pending = await prisma.complex.findMany({
    where: { geocodeStatus: null, address: { not: null } },
    select: { id: true, address: true, addressKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  const result: GeocodingResult = { geocoded: 0, notFound: 0, settledIds: [], failures: [], stoppedBy: null };
  let consecutiveFailures = 0;
  for (const complex of pending) {
    if (shouldStop()) {
      result.stoppedBy = GeocodeStopReason.TIME_BUDGET;
      break;
    }
    const queries = [...new Set([complex.addressKey, complex.address].filter((query) => query !== null))];
    try {
      let point: GeoPoint | null = null;
      for (const query of queries) {
        point = await geocoder.geocode(query);
        if (point !== null) break;
      }
      await prisma.complex.update({
        where: { id: complex.id },
        data:
          point === null
            ? { geocodeStatus: GeocodeStatus.NOT_FOUND }
            : { lat: point.lat, lng: point.lng, geocodeStatus: GeocodeStatus.OK },
      });
      if (point === null) result.notFound += 1;
      else result.geocoded += 1;
      result.settledIds.push(complex.id);
      consecutiveFailures = 0;
    } catch (error) {
      if (!(error instanceof GeocodeError)) throw error;
      result.failures.push({ complexId: complex.id, code: error.code });
      consecutiveFailures += 1;
      if (GEOCODE_STOP_CODES.includes(error.code)) {
        result.stoppedBy = error.code;
        break;
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        result.stoppedBy = GeocodeStopReason.CONSECUTIVE_FAILURES;
        break;
      }
    }
  }
  return result;
};
