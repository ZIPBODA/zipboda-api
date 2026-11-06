import { ScheduleKind, SyncStage } from '../../constants.js';
import type { NormalizedSchedule, Warn } from '../normalized-notice.js';
import { parseDate, parseDateTimeRange, textOrNull } from '../normalize-text.js';
import { LH_LINK_SYSTEM } from './lh.constants.js';
import type { LhRow } from './lh-raw.js';

/** 일정 한 행에서 나온 종류별 일정. target이 있으면 그 이름의 단지에만 해당한다(연계 03의 SBD_LGO_NM) */
export interface LhScheduleRow {
  target: string | null;
  schedules: NormalizedSchedule[];
}

const field = (row: LhRow, name: string): string | null => textOrNull(row[name]);

const dateOf = (row: LhRow, name: string, warn: Warn): string | null => {
  const text = field(row, name);
  const date = parseDate(text);
  if (text !== null && date === null) warn(SyncStage.NORMALIZE, 'UNPARSEABLE_DATE', `${name}: ${text}`);
  return date;
};

/** 시작·끝 중 하나라도 있으면 일정을 만든다. 시작이 끝보다 늦으면 DB가 받지 않아 끝을 비운다 */
const scheduleOf = (
  kind: ScheduleKind,
  dates: { startDate: string | null; endDate: string | null; startTime?: string | null; endTime?: string | null },
  extra: { label?: string | null; note?: string | null },
  warn: Warn,
): NormalizedSchedule[] => {
  if (dates.startDate === null && dates.endDate === null) return [];
  let { endDate } = dates;
  let endTime = dates.endTime ?? null;
  if (dates.startDate !== null && endDate !== null && dates.startDate > endDate) {
    warn(SyncStage.NORMALIZE, 'SCHEDULE_PERIOD_INVERTED', `${kind} ${dates.startDate}~${endDate} — 끝을 비웠다`);
    endDate = null;
    endTime = null;
  }
  return [
    {
      kind,
      label: extra.label ?? null,
      startDate: dates.startDate,
      endDate,
      startTime: dates.startTime ?? null,
      endTime,
      note: extra.note ?? null,
    },
  ];
};

const singleDay = (kind: ScheduleKind, date: string | null, label: string | null, warn: Warn) =>
  scheduleOf(kind, { startDate: date, endDate: date }, { label }, warn);

/**
 * 연계 03(국민·영구·행복·매입임대 등). 접수 날짜는 SBSC_ACP_*를 따르고, 접수 시각(ACP_DTTM)은 날짜가 같을 때만 담는다
 * — 같은 공고에서 마감일 9/17과 접수 시각 '9/16 16:00'이 함께 오는 일이 있다(ERD §5 규칙 9)
 */
const leaseRowOf = (row: LhRow, warn: Warn): LhScheduleRow => {
  const acceptText = field(row, 'ACP_DTTM');
  const accept = parseDateTimeRange(acceptText);
  const startDate = dateOf(row, 'SBSC_ACP_ST_DT', warn) ?? accept.start.date;
  const endDate = dateOf(row, 'SBSC_ACP_CLSG_DT', warn) ?? accept.end.date;
  const startMatches = accept.start.date === null || accept.start.date === startDate;
  const endMatches = accept.end.date === null || accept.end.date === endDate;
  if (!startMatches || !endMatches) {
    warn(SyncStage.NORMALIZE, 'APPLY_TIME_DATE_MISMATCH', `접수 ${startDate}~${endDate}와 접수 시각(${acceptText})의 날짜가 달라 다른 쪽 시각을 비웠다`);
  }
  return {
    target: field(row, 'SBD_LGO_NM'),
    schedules: [
      ...scheduleOf(
        ScheduleKind.APPLY,
        {
          startDate,
          endDate,
          startTime: startMatches ? accept.start.time : null,
          endTime: endMatches ? accept.end.time : null,
        },
        {},
        warn,
      ),
      ...singleDay(ScheduleKind.DOC_TARGET, dateOf(row, 'PPR_SBM_OPE_ANC_DT', warn), null, warn),
      ...scheduleOf(
        ScheduleKind.DOC_SUBMIT,
        { startDate: dateOf(row, 'PPR_ACP_ST_DT', warn), endDate: dateOf(row, 'PPR_ACP_CLSG_DT', warn) },
        {},
        warn,
      ),
      ...scheduleOf(
        ScheduleKind.VIEWING,
        { startDate: dateOf(row, 'HS_VIE_ST_DT', warn), endDate: dateOf(row, 'HS_VIE_ED_DT', warn) },
        {},
        warn,
      ),
      ...singleDay(ScheduleKind.WINNER, dateOf(row, 'PZWR_ANC_DT', warn), null, warn),
      ...scheduleOf(
        ScheduleKind.CONTRACT,
        { startDate: dateOf(row, 'CTRT_ST_DT', warn), endDate: dateOf(row, 'CTRT_ED_DT', warn) },
        {},
        warn,
      ),
    ],
  };
};

/** 연계 02(분양·10년/6년 공공임대·신혼희망 분양). 행마다 대상(특별공급·무순위 등)이 있고 접수는 ACP_DTTM에만 있다 */
const salesRowOf = (row: LhRow, warn: Warn): LhScheduleRow => {
  const label = field(row, 'HS_SBSC_ACP_TRG_CD_NM');
  const acceptText = field(row, 'ACP_DTTM');
  const accept = parseDateTimeRange(acceptText);
  if (acceptText !== null && accept.start.date === null && accept.end.date === null) {
    warn(SyncStage.NORMALIZE, 'UNPARSEABLE_DATE', `ACP_DTTM: ${acceptText}`);
  }
  return {
    target: null,
    schedules: [
      ...scheduleOf(
        ScheduleKind.APPLY,
        {
          startDate: accept.start.date,
          endDate: accept.end.date,
          startTime: accept.start.time,
          endTime: accept.end.time,
        },
        { label, note: field(row, 'RMK') },
        warn,
      ),
      ...singleDay(ScheduleKind.WINNER, dateOf(row, 'PZWR_ANC_DT', warn), label, warn),
      ...scheduleOf(
        ScheduleKind.WINNER_DOC,
        { startDate: dateOf(row, 'PZWR_PPR_SBM_ST_DT', warn), endDate: dateOf(row, 'PZWR_PPR_SBM_ED_DT', warn) },
        { label },
        warn,
      ),
      ...scheduleOf(
        ScheduleKind.CONTRACT,
        { startDate: dateOf(row, 'CTRT_ST_DT', warn), endDate: dateOf(row, 'CTRT_ED_DT', warn) },
        { label },
        warn,
      ),
    ],
  };
};

/** 상세의 일정 목록(dsSplScdl)을 연계시스템에 맞게 읽는다 */
export const lhScheduleRowsOf = (rows: LhRow[], linkSystem: string, warn: Warn): LhScheduleRow[] =>
  rows.map((row) => (linkSystem === LH_LINK_SYSTEM.SALES ? salesRowOf(row, warn) : leaseRowOf(row, warn)));
