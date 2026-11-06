import { AgencyCode } from '@/common/constants/interface-codes.js';
import { nameKeyOf } from '../../complex-keys.js';
import { NoticeSourceName, SyncStage } from '../../constants.js';
import { summaryOf } from '../listing-summary.js';
import type {
  NoticeAttachment,
  NormalizationWarning,
  NormalizedListing,
  NormalizeResult,
  NormalizedSchedule,
  Warn,
} from '../normalized-notice.js';
import { correctionMarksOf, parseDate, textOrNull, titleKeyOf } from '../normalize-text.js';
import { classifyLhNotice } from './lh-classify.js';
import { addCounts, complexDraftsOf, supplyRowDraftsOf, type ListingDraft } from './lh-listings.js';
import { LH_LINK_SYSTEM, LH_QUERY_REGIONS } from './lh.constants.js';
import { datasetsOf, supplyRowsOf, type LhNoticeBundle, type LhRow } from './lh-raw.js';
import { lhScheduleRowsOf, type LhScheduleRow } from './lh-schedules.js';

const KNOWN_LINK_SYSTEMS: readonly string[] = Object.values(LH_LINK_SYSTEM);

const field = (row: LhRow, name: string): string | null => textOrNull(row[name]);

const attachmentsOf = (rows: LhRow[]): NoticeAttachment[] =>
  rows.flatMap((row) => {
    const url = field(row, 'AHFL_URL');
    return url === null ? [] : [{ name: field(row, 'CMN_AHFL_NM') ?? url, url, kind: field(row, 'SL_PAN_AHFL_DS_CD_NM') }];
  });

/**
 * 일정을 칸에 나눈다(ERD §5 규칙 2) — 단지 이름이 비면 모든 칸, 있으면 그 이름의 칸에만. 수집 지역 밖이라 건너뛴 단지의
 * 일정은 버린다. 맞는 칸이 없으면 일정을 잃지 않도록 모든 칸에 넣고 경고를 남긴다
 */
const distributeSchedules = (
  drafts: ListingDraft[],
  rows: LhScheduleRow[],
  skippedNameKeys: ReadonlySet<string>,
  warn: Warn,
): NormalizedSchedule[][] => {
  const byDraft = drafts.map((): NormalizedSchedule[] => []);
  const everyDraft = drafts.map((_draft, index) => index);
  for (const { target, schedules } of rows) {
    const targetKey = target === null ? null : nameKeyOf(target);
    if (targetKey !== null && skippedNameKeys.has(targetKey)) continue;
    let indexes =
      targetKey === null
        ? everyDraft
        : drafts.flatMap((draft, index) => (draft.nameKeys.includes(targetKey) ? [index] : []));
    if (indexes.length === 0) {
      warn(SyncStage.MATCH, 'SCHEDULE_COMPLEX_UNMATCHED', `일정의 단지(${target})를 찾지 못해 모든 칸에 넣었다`);
      indexes = everyDraft;
    }
    for (const index of indexes) byDraft[index].push(...schedules);
  }
  return byDraft;
};

const listingOf = (draft: ListingDraft, schedules: NormalizedSchedule[], warn: Warn): NormalizedListing => ({
  complex: draft.complex,
  regionCode: draft.regionCode,
  moveInMonth: draft.moveInMonth,
  supplyNote: draft.supplyNote,
  units: draft.units,
  schedules,
  supplyUnits: draft.units.reduce<number | null>(
    (sum, unit) => addCounts(sum, unit.supplyHouseholds),
    draft.buildingSupplyUnits,
  ),
  recruitCount: draft.units.reduce<number | null>((sum, unit) => addCounts(sum, unit.recruitCount), draft.buildingRecruitCount),
  summary: summaryOf(schedules, warn),
});

/** 같은 사정이 칸·행마다 되풀이되어도 동기화 기록(sync_failures)은 (단계, 코드)당 한 건이라 여기서 합친다 */
const mergeWarnings = (warnings: NormalizationWarning[]): NormalizationWarning[] => {
  const merged = new Map<string, NormalizationWarning>();
  for (const warning of warnings) {
    const key = `${warning.stage}:${warning.code}`;
    const existing = merged.get(key);
    if (existing === undefined) merged.set(key, { ...warning });
    else if (!existing.message.split(' / ').includes(warning.message)) existing.message += ` / ${warning.message}`;
  }
  return [...merged.values()];
};

/**
 * LH 공고 한 건(목록 행 + 상세 + 공급정보)을 원천과 상관없는 모양으로 바꾼다. DB는 보지 않는다 —
 * 같은 단지·정정 묶음 판별과 저장은 동기화 단계가 한다
 */
export const normalizeLhNotice = (bundle: LhNoticeBundle): NormalizeResult => {
  const { notice } = bundle;
  const classification = classifyLhNotice(notice);
  const linkSystem = notice.CCR_CNNT_SYS_DS_CD ?? '';
  if (classification.kind === 'exclude') return { kind: 'excluded', reason: classification.reason, warnings: [] };
  if (classification.kind === 'unknown' || !KNOWN_LINK_SYSTEMS.includes(linkSystem)) {
    const what =
      classification.kind === 'unknown'
        ? `유형 ${classification.typeKey}(${notice.UPP_AIS_TP_NM}/${notice.AIS_TP_CD_NM})`
        : `연계시스템 ${linkSystem}`;
    return {
      kind: 'unclassified',
      warning: { stage: SyncStage.NORMALIZE, code: 'UNCLASSIFIED_TYPE', message: `분류표에 없는 ${what}` },
    };
  }
  if (!Object.hasOwn(LH_QUERY_REGIONS, bundle.queryRegion)) {
    throw new Error(`LH 조회 지역 코드가 아닙니다: ${bundle.queryRegion}`);
  }
  const queryRegion = LH_QUERY_REGIONS[bundle.queryRegion];
  const detail = datasetsOf(bundle.detail);
  // 일정 목록은 모든 유형의 상세에 있다. 없으면 응답이 비거나 깨진 것이라, 단지 없는 칸으로 읽어 기존 칸을 지우지 않게 멈춘다
  if (!detail.has('dsSplScdl')) {
    return {
      kind: 'invalid',
      warning: { stage: SyncStage.FETCH, code: 'DETAIL_EMPTY', message: '상세 응답에 일정 목록(dsSplScdl)이 없다' },
    };
  }

  const warnings: NormalizationWarning[] = [];
  const warn: Warn = (stage, code, message) => warnings.push({ stage, code, message });
  const supplyRows = supplyRowsOf(datasetsOf(bundle.supply));
  const complexRows = detail.get('dsSbd') ?? [];
  const { drafts, skippedNameKeys } =
    complexRows.length > 0
      ? complexDraftsOf(complexRows, detail.get('dsSbdAhfl') ?? [], supplyRows, linkSystem, queryRegion, warn)
      : supplyRowDraftsOf(supplyRows, queryRegion, warn);
  if (drafts.length === 0) {
    return {
      kind: 'excluded',
      reason: '수집 지역(서울·인천·경기) 안의 단지·건물이 없다',
      warnings: mergeWarnings(warnings),
    };
  }

  const scheduleRows = lhScheduleRowsOf(detail.get('dsSplScdl') ?? [], linkSystem, warn);
  const schedulesByDraft = distributeSchedules(drafts, scheduleRows, skippedNameKeys, warn);
  const listings = drafts.map((draft, index) => listingOf(draft, schedulesByDraft[index], warn));
  const title = (notice.PAN_NM ?? '').trim();
  return {
    kind: 'notice',
    notice: {
      source: NoticeSourceName.LH,
      sourceKey: `${linkSystem}:${notice.PAN_ID}`,
      sourceParams: {
        CCR_CNNT_SYS_DS_CD: linkSystem,
        PAN_ID: notice.PAN_ID ?? '',
        SPL_INF_TP_CD: notice.SPL_INF_TP_CD ?? '',
        UPP_AIS_TP_CD: notice.UPP_AIS_TP_CD ?? '',
        AIS_TP_CD: notice.AIS_TP_CD ?? '',
        CNP_CD: bundle.queryRegion,
      },
      agencyCode: AgencyCode.LH,
      title,
      titleKey: titleKeyOf(title),
      correctionMarks: correctionMarksOf(title),
      supplyCategory: classification.category,
      supplyType: field(notice, 'AIS_TP_CD_NM'),
      postDate: parseDate(field(notice, 'PAN_DT')) ?? parseDate(field(notice, 'PAN_NT_ST_DT')),
      applyUrl: field(notice, 'DTL_URL'),
      sourceStatus: field(notice, 'PAN_SS'),
      attachments: attachmentsOf(detail.get('dsAhflInfo') ?? []),
      listings,
      warnings: mergeWarnings(warnings),
    },
  };
};
