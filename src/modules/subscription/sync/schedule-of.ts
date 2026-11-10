import { SyncStage, type ScheduleKind } from '../constants.js';
import type { NormalizedSchedule, Warn } from './normalized-notice.js';

/** 시작·끝 중 하나라도 있으면 일정을 만든다. 시작이 끝보다 늦으면 DB가 받지 않아 끝을 비운다 */
export const scheduleOf = (
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
