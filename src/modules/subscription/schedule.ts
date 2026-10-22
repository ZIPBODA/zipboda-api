import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import { SERVICE_TIME_ZONE } from './constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** DB의 날짜(date) 열은 UTC 자정으로 읽힌다. 시각을 버리고 날짜만 남긴다 */
export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const serviceDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SERVICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 서버가 어느 시간대에서 돌든 공고 일정은 한국 날짜로 센다 — 자정 직후 UTC 서버가 하루 늦게 마감시키지 않게.
 * 로캘마다 날짜 표기 순서가 달라 조각을 받아 직접 잇는다. 조각이 빠지면 잘못된 날짜로 상태를 지어내지 않고 실패한다
 */
export const serviceDateOf = (now: Date): string => {
  const parts = serviceDateFormat.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (!value) throw new Error(`날짜 조각(${type})을 얻지 못했습니다`);
    return value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
};

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

/** 공급 호수 한 자리를 몇 명이 겨뤘는지. 나누어떨어지면 소수점을 붙이지 않는다(691.0:1 → 691:1) */
export const competitionOf = (applicationCount: number | null, supplyUnits: number | null): string | null => {
  if (applicationCount === null || supplyUnits === null || supplyUnits <= 0) return null;
  const rate = applicationCount / supplyUnits;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}:1`;
};
