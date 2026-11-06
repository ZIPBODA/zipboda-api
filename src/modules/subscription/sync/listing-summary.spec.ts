import { jest } from '@jest/globals';
import { ScheduleKind } from '../constants.js';
import { summaryOf } from './listing-summary.js';
import type { NormalizedSchedule, Warn } from './normalized-notice.js';

const schedule = (kind: ScheduleKind, startDate: string | null, endDate: string | null): NormalizedSchedule => ({
  kind,
  label: null,
  startDate,
  endDate,
  startTime: null,
  endTime: null,
  note: null,
});

describe('칸의 요약 일정(ERD §5 규칙 2)', () => {
  it('접수는 가장 이른 시작·가장 늦은 마감, 당첨은 가장 이른 날, 계약은 가장 이른 시작·가장 늦은 끝', () => {
    const warn = jest.fn<Warn>();
    const summary = summaryOf(
      [
        schedule(ScheduleKind.APPLY, '2026-07-22', '2026-07-23'),
        schedule(ScheduleKind.APPLY, '2026-07-13', '2026-07-14'),
        schedule(ScheduleKind.WINNER, '2026-08-07', '2026-08-07'),
        schedule(ScheduleKind.WINNER, '2026-08-01', '2026-08-01'),
        schedule(ScheduleKind.CONTRACT, '2026-11-12', '2026-11-17'),
        schedule(ScheduleKind.CONTRACT, '2026-11-10', null),
        schedule(ScheduleKind.DOC_SUBMIT, '2026-01-01', '2026-12-31'),
      ],
      warn,
    );
    expect(summary).toEqual({
      applyStartDate: '2026-07-13',
      applyEndDate: '2026-07-23',
      winnerDate: '2026-08-01',
      contractStartDate: '2026-11-10',
      contractEndDate: '2026-11-17',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('접수 일정이 없으면 비우고, 모은 시작이 마감보다 늦으면 지어내지 않고 비운다', () => {
    const warn = jest.fn<Warn>();
    expect(summaryOf([], warn)).toEqual({
      applyStartDate: null,
      applyEndDate: null,
      winnerDate: null,
      contractStartDate: null,
      contractEndDate: null,
    });
    const inverted = summaryOf(
      [schedule(ScheduleKind.APPLY, '2026-09-10', null), schedule(ScheduleKind.APPLY, null, '2026-09-05')],
      warn,
    );
    expect(inverted).toMatchObject({ applyStartDate: null, applyEndDate: null });
    expect(warn).toHaveBeenCalledWith('NORMALIZE', 'APPLY_PERIOD_INVERTED', expect.any(String));
  });
});
