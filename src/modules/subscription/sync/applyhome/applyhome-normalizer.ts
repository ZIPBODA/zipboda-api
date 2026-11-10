import { addressKeyOf, nameKeyOf } from '../../complex-keys.js';
import { NoticeSourceName, ScheduleKind, SupplyCategory, SyncStage } from '../../constants.js';
import { sizeTypeOf } from '../../size-type.js';
import { addCounts } from '../counts.js';
import { summaryOf } from '../listing-summary.js';
import type {
  NormalizationWarning,
  NormalizedComplex,
  NormalizedSchedule,
  NormalizedUnit,
  NormalizeResult,
  Warn,
} from '../normalized-notice.js';
import {
  correctionMarksOf,
  MAX_WON,
  parseArea,
  parseCount,
  parseDate,
  parseWon,
  parseYearMonth,
  sigunguOf,
  textOrNull,
  titleKeyOf,
  unitTypeOf,
} from '../normalize-text.js';
import { scheduleOf } from '../schedule-of.js';
import { mergeWarnings } from '../warnings.js';
import { classifyApplyhomeNotice } from './applyhome-classify.js';
import {
  APPLYHOME_APPLY_FIELDS,
  APPLYHOME_NAME_SUFFIX,
  APPLYHOME_SPECIAL_APPLICATION_FIELD,
  APPLYHOME_WHOLE_APPLY_FIELDS,
  ApplyhomeKind,
  WON_PER_MANWON,
} from './applyhome.constants.js';
import type { ApplyhomeBundle, ApplyhomeRow } from './applyhome-raw.js';

/** 주택형 '059.9700A' — 앞의 0을 채운 전용면적과 타입('A'·'A1') */
const HOUSE_TYPE = /^0*(\d+(?:\.\d+)?)([A-Za-z][A-Za-z0-9]*)?$/;

/** 오피스텔·민간임대는 주택형 대신 타입('34OA')과 전용면적 열을 따로 준다 */
const SEPARATE_AREA_KINDS: readonly ApplyhomeKind[] = [ApplyhomeKind.URBTY, ApplyhomeKind.PBL_PVT_RENT];

const field = (row: ApplyhomeRow, name: string): string | null => textOrNull(row[name]);

const dateOf = (row: ApplyhomeRow, name: string, warn: Warn): string | null => {
  const text = field(row, name);
  const date = parseDate(text);
  if (text !== null && date === null) warn(SyncStage.NORMALIZE, 'UNPARSEABLE_DATE', `${name}: ${text}`);
  return date;
};

/** 만원 단위 금액 → 원(ERD §5 규칙 10). 쉼표가 붙어 오기도 한다('47,552'). 원으로 바꿔 BIGINT를 넘으면 원문 안내로 둔다 */
const wonOfManwon = (text: string | null): { won: bigint | null; note: string | null } => {
  const { won, note } = parseWon(text);
  if (won === null) return { won: null, note };
  const scaled = won * WON_PER_MANWON;
  return scaled <= MAX_WON ? { won: scaled, note: null } : { won: null, note: text };
};

const supplyTypeOf = (kind: ApplyhomeKind, detail: ApplyhomeRow): string | null => {
  if (kind === ApplyhomeKind.APT) {
    const parts = ['HOUSE_SECD_NM', 'HOUSE_DTL_SECD_NM', 'RENT_SECD_NM'].map((name) => field(detail, name));
    return parts.filter((part) => part !== null).join('·') || null;
  }
  return field(detail, kind === ApplyhomeKind.URBTY ? 'HOUSE_DTL_SECD_NM' : 'HOUSE_SECD_NM');
};

/** 같은 단지의 n차 무순위·국민/민영 공고가 한 단지로 모이게 공고명 끝의 회차·구분 표시를 뗀다 */
const complexNameOf = (title: string): string => {
  let name = title.trim();
  while (APPLYHOME_NAME_SUFFIX.test(name)) name = name.replace(APPLYHOME_NAME_SUFFIX, '').trim();
  return name || title.trim();
};

/** rentalDeposit: 분양전환 가능 임대는 최고 금액 열에 분양가가 아니라 임대보증금이 온다(같은 공고 LH 공급정보 LS_GMY의 만원 내림) */
const unitOf = (
  kind: ApplyhomeKind,
  row: ApplyhomeRow,
  rentalDeposit: boolean,
  applicationCount: number | undefined,
  warn: Warn,
): NormalizedUnit => {
  const separateArea = SEPARATE_AREA_KINDS.includes(kind);
  const typeText = field(row, separateArea ? 'TP' : 'HOUSE_TY');
  const match = separateArea ? null : typeText?.match(HOUSE_TYPE);
  const label = match ? `${match[1]}${match[2] ?? ''}` : typeText;
  const exclusiveArea = separateArea ? parseArea(field(row, 'EXCLUSE_AR')) : parseArea(match?.[1] ?? null);
  if (exclusiveArea === null)
    warn(SyncStage.NORMALIZE, 'UNPARSEABLE_AREA', `주택형 ${typeText ?? '(없음)'}의 전용면적`);
  const price = wonOfManwon(field(row, separateArea ? 'SUPLY_AMOUNT' : 'LTTOT_TOP_AMOUNT'));
  return {
    label,
    sizeType: exclusiveArea === null ? null : sizeTypeOf(exclusiveArea),
    unitType: match ? (match[2] ?? null) : unitTypeOf(label),
    exclusiveArea,
    areaMin: null,
    areaMax: null,
    supplyArea: parseArea(field(row, 'SUPLY_AR')),
    unitNumber: null,
    floorLabel: null,
    totalHouseholds: null,
    // 이번 공급 세대 = 일반공급 + 특별공급(ERD §4.7)
    supplyHouseholds: addCounts(parseCount(field(row, 'SUPLY_HSHLDCO')), parseCount(field(row, 'SPSPLY_HSHLDCO'))),
    recruitCount: null,
    depositWon: rentalDeposit ? price.won : null,
    monthlyRentWon: null,
    salePriceWon: rentalDeposit ? null : price.won,
    priceNote: price.note,
    note: null,
    applicationCount,
  };
};

/** 주택형 행의 열쇠 — 경쟁률·특별공급 신청현황은 주택형 원문(HOUSE_TY, 오피스텔은 타입 TP)으로 주택형과 맞춘다 */
const modelTypeOf = (kind: ApplyhomeKind, row: ApplyhomeRow): string | null =>
  field(row, SEPARATE_AREA_KINDS.includes(kind) ? 'TP' : 'HOUSE_TY');

const addTo = (counts: Map<string, number>, type: string, count: number) =>
  counts.set(type, (counts.get(type) ?? 0) + count);

/** 일반공급 신청 인원 — 모든 순위·거주지역 행을 주택형별로 더한다 */
const generalApplicationsOf = (rows: ApplyhomeRow[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const type = field(row, 'HOUSE_TY');
    const count = parseCount(field(row, 'REQ_CNT'));
    if (type !== null && count !== null) addTo(counts, type, count);
  }
  return counts;
};

/** 특별공급 신청 인원 — 지역 × 유형별 신청 수와 기관추천 확정·이전기관을 주택형별로 더한다 */
const specialApplicationsOf = (rows: ApplyhomeRow[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const type = field(row, 'HOUSE_TY');
    if (type === null) continue;
    const count = Object.entries(row)
      .filter(([name]) => APPLYHOME_SPECIAL_APPLICATION_FIELD.test(name))
      .reduce((sum, [, value]) => sum + (parseCount(textOrNull(value)) ?? 0), 0);
    addTo(counts, type, count);
  }
  return counts;
};

/**
 * 주택형별 신청 인원(ERD §5 규칙 18) — 일반공급(모든 순위·거주지역) + 특별공급 신청. 공급 세대(일반 + 특별공급)와 같은 범위를
 * 세어야 경쟁률이 맞는다. 셀 수 없으면 정하지 않는다(undefined) — 저장 단계가 알던 값을 그대로 둔다. 경쟁률이 없는 공고(기관이
 * 직접 접수하거나 아직 접수 전), 잠시 빈 응답, 특별공급 세대가 있는데 신청현황이 없는 주택형(일반공급만 세면 낮게 나온다)이 그렇다
 */
const applicationCountsOf = (bundle: ApplyhomeBundle, warn: Warn): (number | undefined)[] => {
  if (bundle.competitions.length === 0) return bundle.models.map(() => undefined);
  const general = generalApplicationsOf(bundle.competitions);
  const special = specialApplicationsOf(bundle.specialApplications);
  const modelTypes = new Set(bundle.models.map((row) => modelTypeOf(bundle.kind, row)));
  const unmatched = [...general.keys()].filter((type) => !modelTypes.has(type));
  if (unmatched.length > 0) {
    warn(
      SyncStage.MATCH,
      'COMPETITION_TYPE_UNMATCHED',
      `경쟁률의 주택형(${unmatched.join(', ')})이 주택형 목록에 없다`,
    );
  }
  return bundle.models.map((row) => {
    const type = modelTypeOf(bundle.kind, row);
    if (type === null) return undefined;
    // 특별공급만 있는 주택형(일반공급 0세대)은 일반공급 경쟁률 행이 없다 — 일반공급 신청은 0명이다
    const generalSupply = parseCount(field(row, 'SUPLY_HSHLDCO'));
    const generalCount = general.get(type) ?? (generalSupply === 0 ? 0 : undefined);
    if (generalCount === undefined) return undefined;
    if ((parseCount(field(row, 'SPSPLY_HSHLDCO')) ?? 0) === 0) return generalCount;
    const specialCount = special.get(type);
    if (specialCount === undefined) {
      warn(
        SyncStage.MATCH,
        'SPECIAL_APPLICATIONS_MISSING',
        `주택형 ${type}의 특별공급 신청현황이 없어 신청 인원을 정하지 않았다`,
      );
      return undefined;
    }
    return generalCount + specialCount;
  });
};

/** 주택형이 모두 신청 인원을 알 때만 칸의 신청 인원을 낸다 — 일부만 더하면 경쟁률이 낮게 나온다 */
const listingApplicationCountOf = (counts: (number | undefined)[]): number | undefined =>
  counts.length > 0 && counts.every((count) => count !== undefined)
    ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
    : undefined;

/** 조건이 무시된 응답이면 다른 공고의 행이 섞인다 */
const foreignRowOf = (rows: ApplyhomeRow[], houseManageNo: string, pblancNo: string): ApplyhomeRow | undefined =>
  rows.find((row) => field(row, 'HOUSE_MANAGE_NO') !== houseManageNo || field(row, 'PBLANC_NO') !== pblancNo);

/** 대상별 접수 기간이 전체 접수 기간을 다 덮는지 — 일부 대상만 오면 전체 기간도 함께 담아 마감을 잃지 않는다 */
const coversWhole = (byTarget: NormalizedSchedule[], whole: NormalizedSchedule): boolean => {
  const starts = byTarget.flatMap((schedule) => (schedule.startDate === null ? [] : [schedule.startDate])).sort();
  const ends = byTarget.flatMap((schedule) => (schedule.endDate === null ? [] : [schedule.endDate])).sort();
  const startCovered = whole.startDate === null || (starts.length > 0 && starts[0] <= whole.startDate);
  const endCovered = whole.endDate === null || (ends.length > 0 && whole.endDate <= ends[ends.length - 1]);
  return startCovered && endCovered;
};

/** 대상별 접수 열을 담고, 그것이 없거나 전체 접수 기간을 다 덮지 못하면 전체 기간을 더한다(ERD §4.6). 당첨자 발표·계약을 더한다 */
const schedulesOf = (kind: ApplyhomeKind, detail: ApplyhomeRow, warn: Warn): NormalizedSchedule[] => {
  const byTarget = APPLYHOME_APPLY_FIELDS[kind].flatMap(([label, startField, endField]) =>
    scheduleOf(
      ScheduleKind.APPLY,
      { startDate: dateOf(detail, startField, warn), endDate: dateOf(detail, endField, warn) },
      { label },
      warn,
    ),
  );
  const [wholeStart, wholeEnd] = APPLYHOME_WHOLE_APPLY_FIELDS[kind];
  const whole = scheduleOf(
    ScheduleKind.APPLY,
    { startDate: dateOf(detail, wholeStart, warn), endDate: dateOf(detail, wholeEnd, warn) },
    {},
    warn,
  );
  const apply = [...byTarget, ...whole.filter((schedule) => !coversWhole(byTarget, schedule))];
  const winnerDate = dateOf(detail, 'PRZWNER_PRESNATN_DE', warn);
  return [
    ...apply,
    ...scheduleOf(ScheduleKind.WINNER, { startDate: winnerDate, endDate: winnerDate }, {}, warn),
    ...scheduleOf(
      ScheduleKind.CONTRACT,
      {
        startDate: dateOf(detail, 'CNTRCT_CNCLS_BGNDE', warn),
        endDate: dateOf(detail, 'CNTRCT_CNCLS_ENDDE', warn),
      },
      {},
      warn,
    ),
  ];
};

const complexOf = (title: string, address: string | null): NormalizedComplex => {
  const name = complexNameOf(title);
  return {
    name,
    nameKey: nameKeyOf(name),
    aliasable: true,
    sigungu: sigunguOf(address),
    address,
    addressKey: address === null ? null : addressKeyOf(address),
    households: null,
    areaMin: null,
    areaMax: null,
    imageUrl: null,
  };
};

/**
 * 청약홈 공고 한 건(상세 + 주택형)을 원천과 상관없는 모양으로 바꾼다(ERD §5 규칙 18). 청약홈 공고는 단지 하나이고 정정을
 * 같은 공고번호에 덮어써 정정 표시가 없다. 경쟁률(신청 인원)은 저장 단계가 채운다
 */
export const normalizeApplyhomeNotice = (bundle: ApplyhomeBundle): NormalizeResult => {
  const { kind, detail } = bundle;
  const classification = classifyApplyhomeNotice(kind, detail);
  if (classification.kind === 'exclude') {
    return { kind: 'excluded', reason: classification.reason, warnings: classification.warnings };
  }
  if (classification.kind === 'unknown') {
    return {
      kind: 'unclassified',
      warning: {
        stage: SyncStage.NORMALIZE,
        code: 'UNCLASSIFIED_TYPE',
        message: `분류표에 없는 청약홈 유형 ${classification.typeKey}(${supplyTypeOf(kind, detail) ?? '구분 없음'})`,
      },
    };
  }
  const houseManageNo = field(detail, 'HOUSE_MANAGE_NO');
  const pblancNo = field(detail, 'PBLANC_NO');
  const title = field(detail, 'HOUSE_NM');
  if (houseManageNo === null || pblancNo === null || title === null) {
    return {
      kind: 'invalid',
      warning: { stage: SyncStage.FETCH, code: 'DETAIL_EMPTY', message: '상세에 주택관리번호·공고번호·주택명이 없다' },
    };
  }
  // 주택형이 비면 응답이 비거나 깨진 것이다 — 이대로 저장하면 기존 주택형을 지우게 되어 멈춘다(ERD §5 규칙 13)
  if (bundle.models.length === 0) {
    return {
      kind: 'invalid',
      warning: { stage: SyncStage.FETCH, code: 'MODELS_EMPTY', message: '주택형 응답이 비었다' },
    };
  }
  // 남의 주택형·신청 인원을 이 공고에 저장하지 않게 멈춘다
  const foreignModel = foreignRowOf(bundle.models, houseManageNo, pblancNo);
  if (foreignModel !== undefined) {
    return {
      kind: 'invalid',
      warning: {
        stage: SyncStage.FETCH,
        code: 'MODELS_MISMATCH',
        message: `주택형 응답에 다른 공고(${foreignModel.HOUSE_MANAGE_NO ?? '?'}:${foreignModel.PBLANC_NO ?? '?'})가 섞였다`,
      },
    };
  }
  const foreignCompetition = foreignRowOf(
    [...bundle.competitions, ...bundle.specialApplications],
    houseManageNo,
    pblancNo,
  );
  if (foreignCompetition !== undefined) {
    return {
      kind: 'invalid',
      warning: {
        stage: SyncStage.FETCH,
        code: 'COMPETITIONS_MISMATCH',
        message: `경쟁률 응답에 다른 공고(${foreignCompetition.HOUSE_MANAGE_NO ?? '?'}:${foreignCompetition.PBLANC_NO ?? '?'})가 섞였다`,
      },
    };
  }

  const warnings: NormalizationWarning[] = [];
  const warn: Warn = (stage, code, message) => warnings.push({ stage, code, message });
  const address = field(detail, 'HSSPLY_ADRES');
  const rentalDeposit = classification.category === SupplyCategory.PUBLIC_RENTAL;
  const applicationCounts = applicationCountsOf(bundle, warn);
  const units = bundle.models.map((row, index) => unitOf(kind, row, rentalDeposit, applicationCounts[index], warn));
  const schedules = schedulesOf(kind, detail, warn);
  const moveInText = field(detail, 'MVN_PREARNGE_YM');
  const moveInMonth = parseYearMonth(moveInText);
  if (moveInText !== null && moveInMonth === null) {
    warn(SyncStage.NORMALIZE, 'UNPARSEABLE_MONTH', `MVN_PREARNGE_YM: ${moveInText}`);
  }
  const postDate = dateOf(detail, 'RCRIT_PBLANC_DE', warn);
  return {
    kind: 'notice',
    notice: {
      source: NoticeSourceName.APPLYHOME,
      sourceKey: `${houseManageNo}:${pblancNo}`,
      sourceParams: { KIND: kind, HOUSE_MANAGE_NO: houseManageNo, PBLANC_NO: pblancNo },
      agencyCode: classification.agency,
      title,
      titleKey: titleKeyOf(title),
      correctionMarks: correctionMarksOf(title),
      supplyCategory: classification.category,
      supplyType: supplyTypeOf(kind, detail),
      postDate,
      applyUrl: field(detail, 'PBLANC_URL') ?? field(detail, 'HMPG_ADRES'),
      sourceStatus: null,
      attachments: [],
      listings: [
        {
          complex: complexOf(title, address),
          regionCode: classification.regionCode,
          moveInMonth,
          supplyUnits: units.reduce<number | null>((sum, unit) => addCounts(sum, unit.supplyHouseholds), null),
          recruitCount: null,
          supplyNote: null,
          applicationCount: listingApplicationCountOf(applicationCounts),
          schedules,
          units,
          summary: summaryOf(schedules, warn),
        },
      ],
      warnings: mergeWarnings(warnings),
    },
  };
};
