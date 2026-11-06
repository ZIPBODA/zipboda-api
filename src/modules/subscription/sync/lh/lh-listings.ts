import type { StoredRegionCode } from '@/common/constants/interface-codes.js';
import { addressKeyOf, nameKeyOf } from '../../complex-keys.js';
import { SyncStage } from '../../constants.js';
import { sizeTypeOf } from '../../size-type.js';
import type { NormalizedComplex, NormalizedUnit, Warn } from '../normalized-notice.js';
import {
  parseArea,
  parseAreaRange,
  parseCount,
  parseWon,
  parseYearMonth,
  regionOf,
  sigunguOf,
  textOrNull,
  unitTypeOf,
  withoutSidoPrefix,
} from '../normalize-text.js';
import {
  LH_GENERIC_COMPLEX_NAME,
  LH_IMAGE_FILE,
  LH_LINK_SYSTEM,
  LH_PREFERRED_IMAGE_KIND,
} from './lh.constants.js';
import type { LhRow } from './lh-raw.js';

/** 일정을 붙이고 합계를 내기 전의 칸 */
export interface ListingDraft {
  complex: NormalizedComplex | null;
  /** 공급행·일정이 이 칸을 부르는 이름들 — 주소가 같아 합친 단지는 이름이 여럿이다 */
  nameKeys: string[];
  regionCode: StoredRegionCode;
  moveInMonth: string | null;
  supplyNote: string | null;
  units: NormalizedUnit[];
  /** 주택형 없이 건물 단위로만 온 공급 호수·모집 인원(매입임대 DNG_HS_ADR·LTR_SPL_RMNO·QUP_CNT) */
  buildingSupplyUnits: number | null;
  buildingRecruitCount: number | null;
}

export interface ListingDrafts {
  drafts: ListingDraft[];
  /** 수집 지역 밖이라 건너뛴 단지 이름 — 그 단지를 가리키는 공급행·일정은 다른 칸에 붙이지 않고 버린다 */
  skippedNameKeys: ReadonlySet<string>;
}

const field = (row: LhRow, name: string): string | null => textOrNull(row[name]);

export const addCounts = (a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
};

const emptyUnit = (): NormalizedUnit => ({
  label: null,
  sizeType: null,
  unitType: null,
  exclusiveArea: null,
  areaMin: null,
  areaMax: null,
  supplyArea: null,
  unitNumber: null,
  floorLabel: null,
  totalHouseholds: null,
  supplyHouseholds: null,
  recruitCount: null,
  depositWon: null,
  monthlyRentWon: null,
  salePriceWon: null,
  priceNote: null,
  note: null,
});

const emptyDraft = (
  complex: NormalizedComplex | null,
  regionCode: StoredRegionCode,
  extra: Partial<ListingDraft> = {},
): ListingDraft => ({
  complex,
  nameKeys: complex === null ? [] : [complex.nameKey],
  regionCode,
  moveInMonth: null,
  supplyNote: null,
  units: [],
  buildingSupplyUnits: null,
  buildingRecruitCount: null,
  ...extra,
});

/**
 * 지역을 정한다(ERD §5 규칙 15). 시도 이름이 아닌 값('서울지역본부 전세임대')이면 조회 지역으로 두고 경고를 남긴다.
 * 수도권 밖이면 null — 부른 쪽이 건너뛴다
 */
const regionCodeOf = (text: string | null, queryRegion: StoredRegionCode, warn: Warn): StoredRegionCode | null => {
  if (text === null) return queryRegion;
  const lookup = regionOf(text);
  if (lookup.kind === 'metro') return lookup.regionCode;
  if (lookup.kind === 'outside') return null;
  warn(SyncStage.NORMALIZE, 'UNKNOWN_SIDO', `시도를 알 수 없어 조회 지역으로 두었다: ${text}`);
  return queryRegion;
};

/** 기본 주소와 상세 주소('240-1'·'(서창동)')를 잇는다 */
const joinAddress = (base: string | null, detail: string | null): string | null =>
  base === null ? null : [base, detail].filter((part) => part !== null).join(' ');

/** 주택형 표기("70~80㎡"·"전용59㎡"·"59.95")를 전용면적이나 구간으로 */
const areaOfLabel = (label: string | null) => {
  const range = parseAreaRange(label);
  if (range) return { exclusiveArea: null, areaMin: range.min, areaMax: range.max };
  return { exclusiveArea: parseArea(label), areaMin: null, areaMax: null };
};

const withSizeType = (unit: NormalizedUnit): NormalizedUnit => ({
  ...unit,
  sizeType: unit.exclusiveArea === null ? null : sizeTypeOf(unit.exclusiveArea),
});

/** 금액 셋 중 숫자가 아닌 첫 원문("공고문 참조")을 안내로 둔다 */
const pricesOf = (row: LhRow, rentField: string) => {
  const deposit = parseWon(field(row, 'LS_GMY'));
  const rent = parseWon(field(row, rentField));
  const sale = parseWon(field(row, 'SIL_AMT'));
  return {
    depositWon: deposit.won,
    monthlyRentWon: rent.won,
    salePriceWon: sale.won,
    priceNote: deposit.note ?? rent.note ?? sale.note,
  };
};

const moveInOf = (row: LhRow, warn: Warn): string | null => {
  const text = field(row, 'MVIN_XPC_YM');
  const month = parseYearMonth(text);
  if (text !== null && month === null) warn(SyncStage.NORMALIZE, 'UNPARSEABLE_MONTH', `MVIN_XPC_YM: ${text}`);
  return month;
};

/** 단지 첨부 중 이미지 파일만(ERD §5 규칙 16), 조감도를 먼저 */
const imageOf = (attachments: LhRow[], nameKey: string): string | null => {
  const images = attachments.filter(
    (row) =>
      nameKeyOf(row.LCC_NT_NM ?? row.BZDT_NM ?? '') === nameKey && LH_IMAGE_FILE.test(row.CMN_AHFL_NM ?? '') && row.AHFL_URL,
  );
  const kindOf = (row: LhRow) => row.LS_SPL_INF_UPL_FL_DS_CD_NM ?? row.SL_PAN_AHFL_DS_CD_NM ?? '';
  const preferred = images.find((row) => kindOf(row).includes(LH_PREFERRED_IMAGE_KIND));
  return (preferred ?? images[0])?.AHFL_URL ?? null;
};

const areaRangeOfComplex = (text: string | null) => {
  const range = parseAreaRange(text);
  if (range) return range;
  const area = parseArea(text);
  return area === null ? null : { min: area, max: area };
};

/**
 * 상세에 단지 목록(dsSbd)이 있는 공고 — 건설임대·분양. 단지마다 한 칸이고, 공급행은 단지 이름으로 칸에 나눈다.
 * 연계 02는 BZDT_NM·LCT_ARA_ADR·SUM_TOT_HSH_CNT, 연계 03은 LCC_NT_NM·LGDN_ADR·HSH_CNT를 쓴다.
 * 주소 판별 키가 같은 단지 행은 저장할 때 한 단지가 되어 공고 안에서 칸이 겹치므로 여기서 한 칸으로 합친다
 */
export const complexDraftsOf = (
  complexRows: LhRow[],
  complexAttachments: LhRow[],
  supplyRows: LhRow[],
  linkSystem: string,
  queryRegion: StoredRegionCode,
  warn: Warn,
): ListingDrafts => {
  const sales = linkSystem === LH_LINK_SYSTEM.SALES;
  const nameField = sales ? 'BZDT_NM' : 'LCC_NT_NM';
  const drafts: ListingDraft[] = [];
  const skippedNameKeys = new Set<string>();
  for (const row of complexRows) {
    const name = field(row, nameField);
    if (name === null) {
      warn(SyncStage.MATCH, 'COMPLEX_NAME_MISSING', `${nameField}가 비어 단지를 건너뛰었다`);
      continue;
    }
    const nameKey = nameKeyOf(name);
    const address = joinAddress(
      field(row, sales ? 'LCT_ARA_ADR' : 'LGDN_ADR'),
      field(row, sales ? 'LCT_ARA_DTL_ADR' : 'LGDN_DTL_ADR'),
    );
    const regionCode = regionCodeOf(address, queryRegion, warn);
    if (regionCode === null) {
      warn(SyncStage.NORMALIZE, 'OUT_OF_REGION', `수집 지역 밖 단지를 건너뛰었다: ${name} (${address})`);
      skippedNameKeys.add(nameKey);
      continue;
    }
    const addressKey = address === null ? null : addressKeyOf(address);
    const sameAddress = addressKey === null ? undefined : drafts.find((draft) => draft.complex?.addressKey === addressKey);
    if (sameAddress) {
      warn(SyncStage.MATCH, 'COMPLEX_MERGED_BY_ADDRESS', `주소가 같아 한 칸으로 합쳤다: ${sameAddress.complex?.name} ← ${name}`);
      sameAddress.nameKeys.push(nameKey);
      continue;
    }
    const area = areaRangeOfComplex(field(row, sales ? 'MIN_MAX_RSDN_DDO_AR' : 'DDO_AR'));
    const complex: NormalizedComplex = {
      name,
      nameKey,
      aliasable: !LH_GENERIC_COMPLEX_NAME.test(nameKey),
      sigungu: sigunguOf(address),
      address,
      addressKey,
      households: parseCount(field(row, sales ? 'SUM_TOT_HSH_CNT' : 'HSH_CNT')),
      areaMin: area?.min ?? null,
      areaMax: area?.max ?? null,
      imageUrl: imageOf(complexAttachments, nameKey),
    };
    drafts.push(
      emptyDraft(complex, regionCode, {
        moveInMonth: moveInOf(row, warn),
        supplyNote: field(row, 'SPL_INF_GUD_FCTS'),
      }),
    );
  }

  const supplyNameField = sales ? 'BZDT_NM' : 'SBD_LGO_NM';
  for (const row of supplyRows) {
    const target = field(row, supplyNameField);
    const targetKey = target === null ? null : nameKeyOf(target);
    if (targetKey !== null && skippedNameKeys.has(targetKey)) continue;
    let draft = drafts.find((candidate) => targetKey !== null && candidate.nameKeys.includes(targetKey));
    // 단지가 하나뿐인 공고는 공급행이 단지를 다른 이름으로 불러도(가정어린이집 공고의 '…행복주택(신혼희망타운)') 그 단지의 것이다.
    // 단지를 건너뛰어 하나만 남은 경우는 아니다 — 남은 단지에 남의 주택형이 붙는다
    if (draft === undefined && complexRows.length === 1 && drafts.length === 1) {
      draft = drafts[0];
      if (targetKey !== null) {
        warn(SyncStage.MATCH, 'UNIT_COMPLEX_NAME_DIFFERS', `공급행의 단지 이름(${target})이 달라도 하나뿐인 단지에 넣었다`);
      }
    }
    if (draft === undefined) {
      warn(SyncStage.MATCH, 'UNIT_COMPLEX_UNMATCHED', `공급행의 단지(${target})를 단지 목록에서 찾지 못해 건너뛰었다`);
      continue;
    }
    const label = field(row, sales ? 'HTY_NM' : 'HTY_NNA');
    draft.units.push(
      withSizeType({
        ...emptyUnit(),
        label,
        unitType: unitTypeOf(label),
        exclusiveArea: parseArea(field(row, sales ? 'RSDN_DDO_AR' : 'DDO_AR')),
        supplyArea: parseArea(field(row, 'SPL_AR')),
        totalHouseholds: parseCount(field(row, sales ? 'TOT_HSH_CNT' : 'HSH_CNT')),
        supplyHouseholds: parseCount(field(row, sales ? 'SIL_HSH_CNT' : 'NOW_HSH_CNT')),
        ...pricesOf(row, sales ? 'MM_RFE' : 'RFE'),
      }),
    );
  }
  return { drafts, skippedNameKeys };
};

/** 호별 주소 'OO로 58-9(소사본동) 한결주택 101동/소사구'에서 건물 이름('한결주택') */
const buildingNameOfAddress = (address: string): string | null => {
  const afterParenthesis = address.split(')').slice(1).join(')').split('/')[0];
  const words = afterParenthesis.trim().split(/\s+/).filter((word) => word && !/^\d+[동호층]$/.test(word));
  return words.length > 0 ? words.join(' ') : null;
};

/** 리츠 매입임대의 '(서울관악구) 신림동 관악산휴먼시아1단지' → 시군구·단지명 */
const reitsNameOf = (text: string): { sigungu: string | null; name: string } => {
  const match = text.match(/^\(([^)]+)\)\s*(.+)$/);
  return match ? { sigungu: withoutSidoPrefix(match[1]), name: match[2] } : { sigungu: null, name: text };
};

interface SupplyRowComplex {
  key: string;
  complex: NormalizedComplex;
  regionCode: StoredRegionCode | null;
}

const complexOfName = (
  name: string,
  sigungu: string | null,
  regionCode: StoredRegionCode | null,
): SupplyRowComplex => {
  const nameKey = nameKeyOf(name);
  return {
    key: `name:${regionCode}:${sigungu ?? ''}:${nameKey}`,
    complex: {
      name,
      nameKey,
      aliasable: true,
      sigungu,
      address: null,
      addressKey: null,
      households: null,
      areaMin: null,
      areaMax: null,
      imageUrl: null,
    },
    regionCode,
  };
};

/** 공급행 하나가 가리키는 단지. 주소가 있으면 주소로, 없으면 원천 건물 이름으로, 일반명뿐이면 단지 없음(null) */
const complexOfSupplyRow = (row: LhRow, queryRegion: StoredRegionCode, warn: Warn): SupplyRowComplex | null => {
  const address = field(row, 'ADR');
  if (address !== null) {
    const addressKey = addressKeyOf(address);
    const name = buildingNameOfAddress(address) ?? addressKey ?? address;
    return {
      key: `address:${addressKey ?? address}`,
      complex: {
        name,
        nameKey: nameKeyOf(name),
        aliasable: false,
        sigungu: sigunguOf(address),
        address,
        addressKey,
        households: null,
        areaMin: null,
        areaMax: null,
        imageUrl: null,
      },
      regionCode: regionCodeOf(address, queryRegion, warn),
    };
  }
  const building = field(row, 'DNG_HS_ADR');
  if (building !== null) {
    const sido = field(row, 'SGG_NM') ?? field(row, 'CNP_NM');
    return complexOfName(building, sigunguOf(field(row, 'SGG_NM')), regionCodeOf(sido, queryRegion, warn));
  }
  const reits = field(row, 'LTR_UNT_NM');
  if (reits !== null) {
    const { sigungu, name } = reitsNameOf(reits);
    return complexOfName(name, sigungu, regionCodeOf(field(row, 'SBD_CNP_NM'), queryRegion, warn));
  }
  const groupName = field(row, 'SBD_LGO_NM');
  if (groupName !== null && !LH_GENERIC_COMPLEX_NAME.test(nameKeyOf(groupName))) {
    return complexOfName(groupName, null, queryRegion);
  }
  return null;
};

/** 공급행의 주택형. 호별 공급(ADR·HO_NO)은 한 행이 한 호다 */
const unitOfSupplyRow = (row: LhRow): NormalizedUnit | null => {
  const unitNumber = field(row, 'HO_NO');
  if (unitNumber !== null) {
    return withSizeType({
      ...emptyUnit(),
      unitNumber,
      floorLabel: field(row, 'VLD_VL_NM'),
      exclusiveArea: parseArea(field(row, 'DDO_AR')),
      supplyHouseholds: 1,
    });
  }
  const label = field(row, 'HTY_DS_NM');
  if (label === null) return null;
  const note = [field(row, 'RQS_HSH_CNT'), field(row, 'SX_PP_DS_NM')].filter(
    (part) => part !== null && part !== '해당없음',
  );
  // 리츠는 모집 인원을 당첨자수(PZWR_CNT)·예비자수(CAL_QUP_CNT)로 나눠 준다 — 모집 인원은 예비입주자를 포함한다
  const recruitCount =
    parseCount(field(row, 'QUP_CNT')) ??
    addCounts(parseCount(field(row, 'PZWR_CNT')), parseCount(field(row, 'CAL_QUP_CNT')));
  return withSizeType({
    ...emptyUnit(),
    label,
    ...areaOfLabel(label),
    supplyHouseholds: parseCount(field(row, 'LTR_SPL_RMNO') ?? field(row, 'GNR_SPL_RMNO')),
    recruitCount,
    note: note.length > 0 ? note.join(' · ') : null,
  });
};

/**
 * 단지 목록이 없는 공고 — 매입임대. 공급행에서 건물(이름·시군구)이나 호별 주소를 읽어 칸을 나눈다.
 * 일반명뿐인 공급행과 공급행이 아예 없는 공고(주택 목록이 첨부 파일뿐)는 공고 단위 칸 하나에 모은다(ERD §5 규칙 6)
 */
export const supplyRowDraftsOf = (supplyRows: LhRow[], queryRegion: StoredRegionCode, warn: Warn): ListingDrafts => {
  const skippedNameKeys = new Set<string>();
  if (supplyRows.length === 0) return { drafts: [emptyDraft(null, queryRegion)], skippedNameKeys };
  const drafts = new Map<string, ListingDraft>();
  let noticeLevel: ListingDraft | null = null;
  for (const row of supplyRows) {
    const located = complexOfSupplyRow(row, queryRegion, warn);
    let draft: ListingDraft;
    if (located === null) {
      noticeLevel ??= emptyDraft(null, queryRegion);
      draft = noticeLevel;
    } else if (located.regionCode === null) {
      warn(SyncStage.NORMALIZE, 'OUT_OF_REGION', `수집 지역 밖 건물을 건너뛰었다: ${located.complex.name}`);
      skippedNameKeys.add(located.complex.nameKey);
      continue;
    } else {
      draft = drafts.get(located.key) ?? emptyDraft(located.complex, located.regionCode);
      drafts.set(located.key, draft);
    }
    const unit = unitOfSupplyRow(row);
    if (unit !== null) {
      draft.units.push(unit);
      continue;
    }
    draft.buildingSupplyUnits = addCounts(draft.buildingSupplyUnits, parseCount(field(row, 'LTR_SPL_RMNO')));
    draft.buildingRecruitCount = addCounts(draft.buildingRecruitCount, parseCount(field(row, 'QUP_CNT')));
  }
  const listed = [...drafts.values()];
  if (noticeLevel !== null) listed.push(noticeLevel);
  return { drafts: listed, skippedNameKeys };
};
