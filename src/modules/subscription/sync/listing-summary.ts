import { ScheduleKind, SyncStage } from '../constants.js';
import type { ListingSummary, NormalizedSchedule, Warn } from './normalized-notice.js';

const earliest = (dates: (string | null)[]): string | null =>
  dates.filter((date) => date !== null).sort()[0] ?? null;

const latest = (dates: (string | null)[]): string | null =>
  dates
    .filter((date) => date !== null)
    .sort()
    .at(-1) ?? null;

/**
 * 칸의 요약 날짜(ERD §5 규칙 2) — 접수는 가장 이른 시작과 가장 늦은 마감, 당첨 발표는 가장 이른 날, 계약은 가장 이른 시작과
 * 가장 늦은 종료. 접수 시작이 마감보다 늦게 모이면 DB가 받지 않으므로 상태를 지어내지 않고 접수 요약을 비운다
 */
export const summaryOf = (schedules: NormalizedSchedule[], warn: Warn): ListingSummary => {
  const ofKind = (kind: ScheduleKind) => schedules.filter((schedule) => schedule.kind === kind);
  const apply = ofKind(ScheduleKind.APPLY);
  const contract = ofKind(ScheduleKind.CONTRACT);
  let applyStartDate = earliest(apply.map((schedule) => schedule.startDate));
  let applyEndDate = latest(apply.map((schedule) => schedule.endDate));
  if (applyStartDate !== null && applyEndDate !== null && applyStartDate > applyEndDate) {
    warn(SyncStage.NORMALIZE, 'APPLY_PERIOD_INVERTED', `접수 시작 ${applyStartDate}가 마감 ${applyEndDate}보다 늦어 비웠다`);
    applyStartDate = null;
    applyEndDate = null;
  }
  return {
    applyStartDate,
    applyEndDate,
    winnerDate: earliest(ofKind(ScheduleKind.WINNER).map((schedule) => schedule.startDate)),
    contractStartDate: earliest(contract.map((schedule) => schedule.startDate)),
    contractEndDate: latest(contract.map((schedule) => schedule.endDate)),
  };
};
