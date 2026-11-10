import { serviceDateOf } from '../../schedule.js';

const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

/** 예비입주자 모집 등은 게시 뒤 몇 달씩 접수해, 처음 실행이 접수 중인 공고를 빠뜨리지 않게 1년 전 달 초부터 본다 */
const DEFAULT_LOOKBACK_YEARS = 1;

export const SYNC_LH_USAGE = 'pnpm sync:lh [--from=YYYYMMDD] [--to=YYYYMMDD] [--full] [--no-geocode]';

export interface SyncLhArgs {
  /** 공고 게시일 범위 YYYYMMDD */
  from: string;
  to: string;
  full: boolean;
  geocode: boolean;
}

export type SyncLhArgsResult = { ok: true; args: SyncLhArgs } | { ok: false; reason: string };

const isCalendarDate = (value: string): boolean => {
  const match = COMPACT_DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** `pnpm sync:lh` 인자. 날짜를 주지 않으면 한국 날짜 기준으로 1년 전 달 초부터 오늘까지 */
export const parseSyncLhArgs = (argv: readonly string[], now: Date): SyncLhArgsResult => {
  const [year, month, day] = serviceDateOf(now).split('-');
  const args: SyncLhArgs = {
    from: `${Number(year) - DEFAULT_LOOKBACK_YEARS}${month}01`,
    to: `${year}${month}${day}`,
    full: false,
    geocode: true,
  };
  for (const arg of argv) {
    const [name, value] = arg.split('=', 2);
    if (arg === '--full') args.full = true;
    else if (arg === '--no-geocode') args.geocode = false;
    else if ((name === '--from' || name === '--to') && value !== undefined) {
      if (!isCalendarDate(value)) return { ok: false, reason: `${name} 날짜는 YYYYMMDD여야 합니다: ${value}` };
      args[name === '--from' ? 'from' : 'to'] = value;
    } else return { ok: false, reason: `알 수 없는 인자: ${arg}` };
  }
  if (args.from > args.to) return { ok: false, reason: `시작일(${args.from})이 종료일(${args.to})보다 늦습니다` };
  return { ok: true, args };
};

/** 접속 주소에 비밀번호가 들어 있어 호스트·DB 이름만 보인다. 읽지 못하는 주소의 오류에는 주소 전체가 실려 그대로 던지지 않는다 */
export const databaseLabelOf = (databaseUrl: string): string => {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port}${url.pathname}`;
  } catch {
    return '(주소 형식을 읽지 못함)';
  }
};
