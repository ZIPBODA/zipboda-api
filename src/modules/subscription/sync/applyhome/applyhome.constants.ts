import { AgencyCode, type StoredAgencyCode } from '@/common/constants/interface-codes.js';
import { SupplyCategory } from '../../constants.js';

/** 청약홈(한국부동산원) 분양정보·경쟁률 API — 공공데이터포털 15098547·15098905 */
export const APPLYHOME_API_URL = {
  DETAIL: 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/',
  COMPETITION: 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/',
} as const;

export const APPLYHOME_PAGE_SIZE = 500;
/** 주택형·경쟁률은 공고 하나에 수십 행이다 — 이 쪽 수를 넘으면 원천 이상으로 보고 멈춘다 */
export const APPLYHOME_MAX_DETAIL_PAGES = 20;
export const APPLYHOME_TIMEOUT_MS = 60_000;

/** 청약홈은 공고를 다섯 갈래로 나눠 주고, 갈래마다 상세·주택형·경쟁률 오퍼레이션이 따로 있다 */
export const ApplyhomeKind = {
  APT: 'APT',
  /** 무순위·잔여세대·불법행위 재공급 */
  REMNDR: 'REMNDR',
  /** 임의공급 */
  OPT: 'OPT',
  /** 도시형생활주택·오피스텔·민간임대·생활숙박시설 */
  URBTY: 'URBTY',
  /** 공공지원 민간임대 */
  PBL_PVT_RENT: 'PBL_PVT_RENT',
} as const;
export type ApplyhomeKind = (typeof ApplyhomeKind)[keyof typeof ApplyhomeKind];

interface ApplyhomeOperations {
  detail: string;
  model: string;
  competition: string;
  /** 특별공급 신청현황 — APT만 있다. 신청 인원에 특별공급 신청을 더해 공급 세대(일반 + 특별공급)와 맞춘다 */
  specialApplication: string | null;
  /** 모집공고일 조건의 형식 — 임의공급·공공지원 민간임대만 YYYYMMDD로 적고 나머지는 YYYY-MM-DD다 */
  compactPostDate: boolean;
}

export const APPLYHOME_OPERATIONS: Readonly<Record<ApplyhomeKind, ApplyhomeOperations>> = {
  APT: {
    detail: 'getAPTLttotPblancDetail',
    model: 'getAPTLttotPblancMdl',
    competition: 'getAPTLttotPblancCmpet',
    specialApplication: 'getAPTSpsplyReqstStus',
    compactPostDate: false,
  },
  REMNDR: {
    detail: 'getRemndrLttotPblancDetail',
    model: 'getRemndrLttotPblancMdl',
    competition: 'getRemndrLttotPblancCmpet',
    specialApplication: null,
    compactPostDate: false,
  },
  OPT: {
    detail: 'getOPTLttotPblancDetail',
    model: 'getOPTLttotPblancMdl',
    competition: 'getOPTLttotPblancCmpet',
    specialApplication: null,
    compactPostDate: true,
  },
  URBTY: {
    detail: 'getUrbtyOfctlLttotPblancDetail',
    model: 'getUrbtyOfctlLttotPblancMdl',
    competition: 'getUrbtyOfctlLttotPblancCmpet',
    specialApplication: null,
    compactPostDate: false,
  },
  PBL_PVT_RENT: {
    detail: 'getPblPvtRentLttotPblancDetail',
    model: 'getPblPvtRentLttotPblancMdl',
    competition: 'getPblPvtRentLttotPblancCmpet',
    specialApplication: null,
    compactPostDate: true,
  },
};

/**
 * 사업주체(시행사) 이름 → 공급기관(ERD §5 규칙 18). 지역본부를 붙이거나('한국토지주택공사 경기남부지역본부') 붙여 쓰기도 해
 * 앞부분으로 맞춘다. SH는 법인 이름(서울주택도시개발공사)으로 오고, GH의 옛 이름(경기도시공사)도 둔다
 */
export const APPLYHOME_AGENCY_PREFIXES: readonly { prefix: string; agency: StoredAgencyCode }[] = [
  { prefix: '한국토지주택공사', agency: AgencyCode.LH },
  { prefix: '서울주택도시개발공사', agency: AgencyCode.SH },
  { prefix: '서울주택도시공사', agency: AgencyCode.SH },
  { prefix: 'SH공사', agency: AgencyCode.SH },
  { prefix: '경기주택도시공사', agency: AgencyCode.GH },
  { prefix: '경기도시공사', agency: AgencyCode.GH },
  { prefix: '인천도시공사', agency: AgencyCode.IH },
];

/** 공동 사업의 사업주체를 잇는 기호 */
export const APPLYHOME_BUSINESS_ENTITY_SEPARATOR = /[,/·ㆍ]/;

/** 기관 이름 뒤에는 조직 이름(경기남부지역본부·세종특별본부)만 붙는다 */
export const APPLYHOME_AGENCY_UNIT_SUFFIX = /^\s*(\S*본부)?$/;

/**
 * 수집 분류(ERD §5 규칙 18) — `갈래-구분 코드` → 분류. APT는 분양구분(RENT_SECD), 무순위·임의공급은 주택구분(HOUSE_SECD),
 * 도시형·오피스텔은 주택상세구분(HOUSE_DTL_SECD)으로 가른다. 표에 없는 조합(민간임대·생활숙박시설·공공지원 민간임대 등)은
 * 저장하지 않고 경고를 남겨 표를 늘린다
 */
export const APPLYHOME_COLLECTED_TYPES: Readonly<Record<string, SupplyCategory>> = {
  'APT-0': SupplyCategory.SALE, // 분양주택(공공분양·신혼희망타운·민영)
  'APT-1': SupplyCategory.PUBLIC_RENTAL, // 분양전환 가능 임대(6년·10년 공공임대 — LH 06-52·06-08과 같은 분류). 금액은 임대보증금이다
  'REMNDR-04': SupplyCategory.SALE, // 무순위
  'REMNDR-06': SupplyCategory.SALE, // 불법행위 재공급
  'OPT-11': SupplyCategory.SALE, // 임의공급
  'URBTY-01': SupplyCategory.SALE, // 도시형생활주택
  'URBTY-02': SupplyCategory.SALE, // 오피스텔
};

/** 공고명 끝의 회차·접수 구분 표시. 같은 단지의 n차 무순위·국민/민영 공고가 한 단지 이름을 쓰게 뗀다 */
export const APPLYHOME_NAME_SUFFIX = /\s*\((?:본청약|후속사업|국민|민영|민영주택|\d+차)\)\s*$/;

/** 금액은 만원 단위로 온다(ERD §5 규칙 10) */
export const WON_PER_MANWON = 10_000n;

/** 접수 일정의 대상별 열(ERD §4.6) — [대상, 시작일 열, 종료일 열]. 나뉜 열이 하나도 없을 때만 전체 접수 기간 열을 쓴다 */
type ApplyField = readonly [label: string, startField: string, endField: string];

export const APPLYHOME_APPLY_FIELDS: Readonly<Record<ApplyhomeKind, readonly ApplyField[]>> = {
  APT: [
    ['특별공급', 'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE'],
    ['1순위 해당지역', 'GNRL_RNK1_CRSPAREA_RCPTDE', 'GNRL_RNK1_CRSPAREA_ENDDE'],
    ['1순위 경기지역', 'GNRL_RNK1_ETC_GG_RCPTDE', 'GNRL_RNK1_ETC_GG_ENDDE'],
    ['1순위 기타지역', 'GNRL_RNK1_ETC_AREA_RCPTDE', 'GNRL_RNK1_ETC_AREA_ENDDE'],
    ['2순위 해당지역', 'GNRL_RNK2_CRSPAREA_RCPTDE', 'GNRL_RNK2_CRSPAREA_ENDDE'],
    ['2순위 경기지역', 'GNRL_RNK2_ETC_GG_RCPTDE', 'GNRL_RNK2_ETC_GG_ENDDE'],
    ['2순위 기타지역', 'GNRL_RNK2_ETC_AREA_RCPTDE', 'GNRL_RNK2_ETC_AREA_ENDDE'],
  ],
  REMNDR: [
    ['특별공급', 'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE'],
    ['일반공급', 'GNRL_RCEPT_BGNDE', 'GNRL_RCEPT_ENDDE'],
  ],
  OPT: [
    ['특별공급', 'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE'],
    ['일반공급', 'GNRL_RCEPT_BGNDE', 'GNRL_RCEPT_ENDDE'],
  ],
  URBTY: [],
  PBL_PVT_RENT: [],
};

export const APPLYHOME_WHOLE_APPLY_FIELDS: Readonly<Record<ApplyhomeKind, readonly [string, string]>> = {
  APT: ['RCEPT_BGNDE', 'RCEPT_ENDDE'],
  REMNDR: ['SUBSCRPT_RCEPT_BGNDE', 'SUBSCRPT_RCEPT_ENDDE'],
  OPT: ['SUBSCRPT_RCEPT_BGNDE', 'SUBSCRPT_RCEPT_ENDDE'],
  URBTY: ['SUBSCRPT_RCEPT_BGNDE', 'SUBSCRPT_RCEPT_ENDDE'],
  PBL_PVT_RENT: ['SUBSCRPT_RCEPT_BGNDE', 'SUBSCRPT_RCEPT_ENDDE'],
};

/**
 * 특별공급 신청현황의 신청 수 열 — 지역(해당지역·시도·기타지역) × 유형(생애최초·다자녀·신생아·신혼부부·노부모부양·청년)과
 * 기관추천 확정·이전기관. 기관추천 예비(INSTT_RECOMEND_PREPAR_CNT)는 신청이 아니라 뺀다
 */
export const APPLYHOME_SPECIAL_APPLICATION_FIELD =
  /^(?:CRSPAREA|CTPRVN|ETC_AREA)_[A-Z_]+_CNT$|^INSTT_RECOMEND_DCSN_CNT$|^TRANSR_INSTT_ENFSN_CNT$/;
