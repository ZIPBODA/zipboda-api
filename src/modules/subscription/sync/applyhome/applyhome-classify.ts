import type { StoredAgencyCode, StoredRegionCode } from '@/common/constants/interface-codes.js';
import { SyncStage, type SupplyCategory } from '../../constants.js';
import type { NormalizationWarning } from '../normalized-notice.js';
import { regionOf, textOrNull } from '../normalize-text.js';
import {
  APPLYHOME_AGENCY_PREFIXES,
  APPLYHOME_AGENCY_UNIT_SUFFIX,
  APPLYHOME_BUSINESS_ENTITY_SEPARATOR,
  APPLYHOME_COLLECTED_TYPES,
  ApplyhomeKind,
} from './applyhome.constants.js';
import type { ApplyhomeRow } from './applyhome-raw.js';

export type ApplyhomeClassification =
  | { kind: 'collect'; agency: StoredAgencyCode; regionCode: StoredRegionCode; category: SupplyCategory }
  | { kind: 'exclude'; reason: string; warnings: NormalizationWarning[] }
  | { kind: 'unknown'; typeKey: string };

/**
 * 사업주체의 공급기관. 공동 사업은 쉼표 등으로 이어 적는다('인천도시공사,(주)대우건설,…') — 항목마다 기관 이름으로 시작하고
 * 그 뒤에 조직 이름(지역본부 등)만 붙는지 본다. '…경기도시공사참여가로주택정비사업조합'처럼 이름이 섞인 조합은 기관 사업이
 * 아니다. 두 기관의 공동 사업은 먼저 적힌 기관(대표 사업주체)으로 둔다
 */
export const agencyOf = (businessEntity: string | undefined): StoredAgencyCode | null => {
  for (const entity of (businessEntity ?? '').split(APPLYHOME_BUSINESS_ENTITY_SEPARATOR)) {
    const name = entity.trim();
    const found = APPLYHOME_AGENCY_PREFIXES.find(
      ({ prefix }) => name.startsWith(prefix) && APPLYHOME_AGENCY_UNIT_SUFFIX.test(name.slice(prefix.length)),
    );
    if (found !== undefined) return found.agency;
  }
  return null;
};

const typeKeyOf = (kind: ApplyhomeKind, detail: ApplyhomeRow): string => {
  if (kind === ApplyhomeKind.APT) return `${kind}-${detail.RENT_SECD ?? ''}`;
  if (kind === ApplyhomeKind.URBTY) return `${kind}-${detail.HOUSE_DTL_SECD ?? ''}`;
  return `${kind}-${detail.HOUSE_SECD ?? ''}`;
};

/** 칸의 지역(ERD §5 규칙 15) — 공급 위치 주소의 시도, 읽지 못하면 공급지역명('경기') */
const regionOfDetail = (detail: ApplyhomeRow) => {
  const byAddress = regionOf(textOrNull(detail.HSSPLY_ADRES));
  return byAddress.kind === 'unknown' ? regionOf(textOrNull(detail.SUBSCRPT_AREA_CODE_NM)) : byAddress;
};

/**
 * 수집 분류(ERD §5 규칙 18) — 사업주체가 공공 4기관이고 수집 지역 안인 공고를 갈래·구분 코드로 분류한다. 기관·지역을 먼저
 * 봐서, 전국 단위로 오는 목록의 지방 공고가 분류표 밖 경고나 응답 오류로 남지 않게 한다. 상세 행만 보므로 수집기가 주택형·
 * 경쟁률을 부르기 전에 거를 수 있다
 */
export const classifyApplyhomeNotice = (kind: ApplyhomeKind, detail: ApplyhomeRow): ApplyhomeClassification => {
  const agency = agencyOf(detail.BSNS_MBY_NM);
  if (agency === null) {
    return { kind: 'exclude', reason: '사업주체가 공공 4기관(LH·SH·GH·iH)이 아니다', warnings: [] };
  }
  const region = regionOfDetail(detail);
  if (region.kind === 'outside') return { kind: 'exclude', reason: '수집 지역(서울·인천·경기) 밖 공고', warnings: [] };
  if (region.kind === 'unknown') {
    return {
      kind: 'exclude',
      reason: '지역을 정하지 못한 공고',
      warnings: [
        {
          stage: SyncStage.NORMALIZE,
          code: 'UNKNOWN_SIDO',
          message: `공급 위치·공급지역에서 시도를 읽지 못했다: ${detail.HSSPLY_ADRES ?? '(없음)'}`,
        },
      ],
    };
  }
  const typeKey = typeKeyOf(kind, detail);
  if (!Object.hasOwn(APPLYHOME_COLLECTED_TYPES, typeKey)) return { kind: 'unknown', typeKey };
  return { kind: 'collect', agency, regionCode: region.regionCode, category: APPLYHOME_COLLECTED_TYPES[typeKey] };
};
