import { RegionCode, type StoredRegionCode } from '@/common/constants/interface-codes.js';
import { SupplyCategory } from '../../constants.js';

/** 공공데이터포털 LH 임대·분양 공고 API 3종(목록·상세·공급정보) */
export const LH_API_URL = {
  LIST: 'https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1',
  DETAIL: 'https://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1',
  SUPPLY: 'https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1',
} as const;

export const LH_PAGE_SIZE = 100;
export const LH_TIMEOUT_MS = 60_000;

/** 목록을 조회하는 지역(CNP_CD). 단지 정보가 없는 공고 단위 칸은 조회한 지역으로 보인다 */
export const LH_QUERY_REGIONS: Readonly<Record<string, StoredRegionCode>> = {
  '11': RegionCode.SEOUL,
  '28': RegionCode.INCHEON,
  '41': RegionCode.GYEONGGI,
};

/** 목록을 조회하는 상위 유형(UPP_AIS_TP_CD) — 분양주택·임대주택·주거복지·공공분양(신혼희망) */
export const LH_UPPER_TYPES = ['05', '06', '13', '39'] as const;

/**
 * 연계시스템(CCR_CNNT_SYS_DS_CD)마다 필드 이름·날짜 형식이 다르다(ERD §2.1).
 * 02는 분양·10년/6년 공공임대·신혼희망 분양, 03은 국민·영구·행복·매입임대 등이 쓴다
 */
export const LH_LINK_SYSTEM = { SALES: '02', LEASE: '03' } as const;

/**
 * 수집 분류(ERD §5 규칙 14) — `상위 유형-공급 유형`(UPP_AIS_TP_CD-AIS_TP_CD) → 분류.
 * 표에 없는 조합은 저장하지 않고 경고를 남겨 표를 늘린다
 */
export const LH_COLLECTED_TYPES: Readonly<Record<string, SupplyCategory>> = {
  '05-05': SupplyCategory.SALE, // 분양주택(공공분양·공가세대 일반매각)
  '39-39': SupplyCategory.SALE, // 공공분양(신혼희망)
  '39-42': SupplyCategory.PUBLIC_RENTAL, // 행복주택(신혼희망)
  '06-07': SupplyCategory.PUBLIC_RENTAL, // 국민임대
  '06-08': SupplyCategory.PUBLIC_RENTAL, // 공공임대(10년·50년)
  '06-09': SupplyCategory.PUBLIC_RENTAL, // 영구임대
  '06-10': SupplyCategory.PUBLIC_RENTAL, // 행복주택
  '06-48': SupplyCategory.PUBLIC_RENTAL, // 통합공공임대
  '06-52': SupplyCategory.PUBLIC_RENTAL, // 6년 공공임대
  '13-26': SupplyCategory.PURCHASE_RENTAL, // 매입임대(청년·신혼·다자녀·든든전세 등)
};

/** 수집 범위 밖 유형(사용자 결정 2026-10-27) — 이유는 동기화 기록에 남는다 */
export const LH_EXCLUDED_TYPES: Readonly<Record<string, string>> = {
  '06-40': '가정어린이집 운영자 모집',
  '13-17': '전세임대',
  '13-36': '집주인임대',
  '13-37': '집주인임대',
};

export const LH_PURCHASE_RENTAL_TYPE = '13-26';

/** 매입임대 중 입주자가 아니라 운영기관(공동생활가정 등)을 모집하는 공고. 같은 공급정보 유형(135)에 입주자 모집도 있어 공고명으로 가른다 */
export const LH_OPERATOR_RECRUIT_TITLE = /운영기관/;

/** 응답 머리(resHeader)의 처리 결과. 이 값이 아니면 응답 본문을 믿지 않는다 */
export const LH_SUCCESS_CODE = 'Y';

/** 지역만 적은 일반명('매입다가구(경기부천시)') — 여러 건물이 같은 이름을 써 단지로 합치지 않는다(ERD §5 규칙 8) */
export const LH_GENERIC_COMPLEX_NAME = /^매입[^()]*\([^()]+\)$/;

/** 대표 이미지로 쓸 수 있는 첨부(ERD §5 규칙 16). 단지조감도라도 PDF면 첨부로만 둔다 */
export const LH_IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
export const LH_PREFERRED_IMAGE_KIND = '조감도';
