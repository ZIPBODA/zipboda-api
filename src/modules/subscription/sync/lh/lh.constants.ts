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

/** 목록 한 조합(지역×유형)이 이 쪽 수를 넘으면 원천 이상으로 보고 멈춘다(1만 건) */
export const LH_MAX_LIST_PAGES = 100;

/** 공고를 동시에 처리하는 수 — 상세·공급정보를 함께 불러 초당 30건 한도 안에 든다 */
export const LH_SYNC_CONCURRENCY = 4;

/** 접수가 끝난 공고의 상태 — 목록 행이 같으면 다시 부르지 않는다(그 밖은 SYNC_REFRESH_ACTIVE_MS마다 다시) */
export const LH_CLOSED_STATUS = '접수마감';
/** 목록 행이 바뀌었는지 볼 열 — 순번(RNUM)·전체 건수(ALL_CNT)는 조회마다 달라 빼고 본다 */
export const LH_LIST_COMPARED_FIELDS = ['PAN_NM', 'PAN_SS', 'PAN_DT', 'PAN_NT_ST_DT', 'CLSG_DT', 'DTL_URL', 'SPL_INF_TP_CD', 'AIS_TP_CD'] as const;

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

/**
 * 단지 첨부의 AHFL_URL은 사진 파일이 아니라 사진 한 장을 감싼 보기 페이지(HTML)다 — <img>로 그리면 깨진다.
 * 페이지의 <img src>가 실제 사진 주소라 수집이 한 번 읽어 바꿔 둔다(ERD §5 규칙 16)
 */
export const LH_IMAGE_VIEWER = { host: 'apply.lh.or.kr', path: '/lhapply/lhImageView2.do' } as const;
/** 사진 파일은 청약센터의 이 경로 아래에 있다. 오류 그림(/00_common/…)·'이미지 없음' 그림(/images/…)과 가른다 */
export const LH_IMAGE_FILE_PATH = '/upload/';
/**
 * <img>의 src 속성 값. 앞에 공백이 있어야 한다 — 파일이 없는 페이지는 `<img src="" onerror="this.src='…noImg.gif'">`라
 * onerror 안의 this.src를 사진 주소로 읽으면 안 된다. 빈 값도 받는다(파일 없음)
 */
export const LH_IMAGE_SRC = /<img\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/i;
/** 한 번의 실행에서 사진 주소를 바꾸는 단지 수. 처음 바꿀 때 400여 곳이 밀려 있다 */
export const LH_IMAGE_BATCH_SIZE = 500;
export const LH_IMAGE_TIMEOUT_MS = 20_000;
/** 사진 단계가 쓰는 시간 상한 — 느린 응답이 이어져도 뒤의 좌표 단계가 실행 시간 한도를 다 빼앗기지 않게 */
export const LH_IMAGE_TIME_BUDGET_MS = 10 * 60_000;
/** 보기 페이지가 연달아 실패하면(LH 장애·페이지 모양 변경) 남은 단지마다 경고를 쌓지 않고 다음 실행에 넘긴다 */
export const LH_IMAGE_MAX_CONSECUTIVE_FAILURES = 5;
