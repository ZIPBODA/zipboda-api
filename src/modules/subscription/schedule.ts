import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** DB의 날짜(date) 열은 UTC 자정으로 읽힌다. 시각을 버리고 날짜만 남긴다 */
export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** from에서 to까지 남은 날. 같은 날이면 0, 지났으면 음수 */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

export interface ApplySchedule {
  applyStartDate: string | null;
  applyEndDate: string | null;
  cancelled: boolean;
}

/** ITF-002. 일정이 없는 공고는 상태를 지어내지 않고 비운다 */
export const statusCodeOf = (schedule: ApplySchedule, today: string): SubscriptionStatusCode | null => {
  if (schedule.cancelled) return SubscriptionStatusCode.CANCELLED;
  if (!schedule.applyStartDate || !schedule.applyEndDate) return null;
  if (daysBetween(today, schedule.applyStartDate) > 0) return SubscriptionStatusCode.UPCOMING;
  return daysBetween(today, schedule.applyEndDate) < 0 ? SubscriptionStatusCode.CLOSED : SubscriptionStatusCode.OPEN;
};

/** 접수 중일 때만 마감까지 남은 날을 준다. 아직 열리지 않았거나 끝난 공고에는 D-day가 없다 */
export const ddayOf = (schedule: ApplySchedule, today: string): number | null =>
  statusCodeOf(schedule, today) === SubscriptionStatusCode.OPEN && schedule.applyEndDate
    ? daysBetween(today, schedule.applyEndDate)
    : null;
