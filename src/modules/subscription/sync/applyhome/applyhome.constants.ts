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

/** 목록 한 갈래가 이 쪽 수를 넘으면 원천 이상으로 보고 멈춘다(1만 건 — 갈래마다 1년에 수백 건이다) */
export const APPLYHOME_MAX_LIST_PAGES = 20;

/**
 * 공고를 동시에 처리하는 수. 공고마다 주택형·경쟁률(APT는 특별공급 신청현황까지)을 차례로 불러 동시 요청은 이 수를 넘지 않는다.
 * 공고 4건에 요청을 동시에 보냈을 때 경쟁률 API가 429(요청 과다)를 돌려줬다(2026-11-11 개발 DB 수집, 66건 중 13건)
 */
export const APPLYHOME_SYNC_CONCURRENCY = 2;

/** 429(요청 과다)를 받으면 쉬었다가 다시 부르는 횟수와 처음 쉬는 시간(두 배씩 늘린다). 원천이 Retry-After를 주면 그만큼 쉰다 */
export const APPLYHOME_MAX_RETRIES = 3;
export const APPLYHOME_RETRY_BASE_MS = 1_000;
export const APPLYHOME_TOO_MANY_REQUESTS = 429;
/** Retry-After가 이보다 길면 이 실행에서 기다리지 않는다 — 다음 실행이 다시 받는다 */
export const APPLYHOME_MAX_RETRY_WAIT_MS = 30_000;

/**
 * 진행 중인지 볼 날짜 열 — 접수·당첨자 발표·계약 날짜 중 가장 늦은 날이 오늘 이후면 경쟁률·신청 인원이 아직 바뀐다
 * (일반공급 경쟁률은 접수가 끝나야 생긴다)
 */
export const APPLYHOME_PROGRESS_DATE_FIELD = /(?:RCEPT_ENDDE|RCEPT_BGNDE|RCPTDE|ENDDE|PRZWNER_PRESNATN_DE)$/;

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
