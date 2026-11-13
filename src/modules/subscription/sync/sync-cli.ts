import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/database/generated/client.js';
import { SyncStatus, SyncTrigger } from '../constants.js';
import { serviceDateOf } from '../schedule.js';
import { KakaoGeocoder } from './geocode/kakao-geocoder.js';
import { NoticeWriter } from './notice-writer.js';
import { SyncAlreadyRunningError, SyncRunRecorder } from './sync-run-recorder.js';
import type { SyncDependencies, SyncOptions, SyncSummary } from './sync-run-steps.js';

/** 원천별 수집 명령(`pnpm sync:lh`·`pnpm sync:applyhome`)이 함께 쓰는 인자·출력·실행 흐름 */

const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

/** 예비입주자 모집 등은 게시 뒤 몇 달씩 접수해, 처음 실행이 접수 중인 공고를 빠뜨리지 않게 1년 전 달 초부터 본다 */
const DEFAULT_LOOKBACK_YEARS = 1;

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

export const syncUsageOf = (command: string): string =>
  `pnpm ${command} [--from=YYYYMMDD] [--to=YYYYMMDD] [--full] [--no-geocode]`;

export interface SyncArgs {
  /** 공고 게시일 범위 YYYYMMDD */
  from: string;
  to: string;
  full: boolean;
  geocode: boolean;
}

export type SyncArgsResult = { ok: true; args: SyncArgs } | { ok: false; reason: string };

const isCalendarDate = (value: string): boolean => {
  const match = COMPACT_DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** 수집 명령 인자. 날짜를 주지 않으면 한국 날짜 기준으로 1년 전 달 초부터 오늘까지 */
export const parseSyncArgs = (argv: readonly string[], now: Date): SyncArgsResult => {
  const [year, month, day] = serviceDateOf(now).split('-');
  const args: SyncArgs = {
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

export const summaryLinesOf = (summary: SyncSummary): string[] => [
  `결과 ${summary.status} (실행 ${summary.runId})`,
  `목록 ${summary.listed}건 · 받음 ${summary.fetched}건 · 바뀌지 않아 건너뜀 ${summary.skipped}건 · 시간 한도로 다음 실행에 넘김 ${summary.deferred}건`,
  `새 공고 ${summary.created}건 · 갱신 ${summary.updated}건 · 다른 공고에 참조로 이음 ${summary.referenced}건`,
  `수집 범위 밖 ${summary.excluded}건 · 분류표에 없음 ${summary.unclassified}건 · 실패 ${summary.failed}건 · 경고 ${summary.warnings}건`,
  `좌표 ${summary.geocoded}건 · 주소로 못 찾음 ${summary.notFound}건${summary.geocodeStopped === null ? '' : ` · 좌표 찾기 멈춤(${summary.geocodeStopped})`}`,
  `단지 사진 주소 바꿈 ${summary.imagesResolved}건`,
];

export interface SyncCommand {
  /** package.json 스크립트 이름('sync:lh') */
  command: string;
  /** 사람이 읽는 원천 이름('LH') */
  sourceLabel: string;
  createRunner: (deps: SyncDependencies, serviceKey: string) => { run(options: SyncOptions): Promise<SyncSummary> };
}

/**
 * 수집을 한 번 돌리고 종료 코드를 돌려준다(관리자 화면·예약 실행이 생기기 전까지 개발 DB를 채우는 데 쓴다). 공공데이터포털
 * 키 하나로 LH·청약홈을 모두 부른다
 */
export const runSyncCommand = async ({ command, sourceLabel, createRunner }: SyncCommand): Promise<number> => {
  const parsed = parseSyncArgs(process.argv.slice(2), new Date());
  if (!parsed.ok) {
    console.error(`${parsed.reason}\n사용법: ${syncUsageOf(command)}`);
    return EXIT_USAGE;
  }
  const { from, to, full, geocode } = parsed.args;
  const databaseUrl = process.env.DATABASE_URL;
  const serviceKey = process.env.PUBLIC_DATA_SERVICE_KEY;
  if (!databaseUrl || !serviceKey) {
    console.error('.env에 DATABASE_URL과 PUBLIC_DATA_SERVICE_KEY가 있어야 합니다');
    return EXIT_USAGE;
  }
  const kakaoKey = geocode ? process.env.KAKAO_REST_API_KEY : undefined;
  if (geocode && !kakaoKey) console.log('KAKAO_REST_API_KEY가 없어 좌표는 채우지 않습니다');

  console.log(
    `${sourceLabel} · DB ${databaseLabelOf(databaseUrl)} · 게시일 ${from}~${to}${full ? ' · 모두 다시 받기' : ''}`,
  );
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const runner = createRunner(
      {
        prisma,
        writer: new NoticeWriter(prisma),
        recorder: new SyncRunRecorder(prisma),
        geocoder: kakaoKey ? new KakaoGeocoder(kakaoKey) : null,
        now: () => new Date(),
        log: (message) => console.log(message),
      },
      serviceKey,
    );
    const summary = await runner.run({ trigger: SyncTrigger.CLI, from, to, full });
    console.log(summaryLinesOf(summary).join('\n'));
    if (summary.failed > 0 || summary.warnings > 0) console.log('실패·경고는 sync_failures(미해결)에서 확인합니다');
    return summary.status === SyncStatus.FAILED ? EXIT_FAILED : 0;
  } catch (error) {
    if (!(error instanceof SyncAlreadyRunningError)) throw error;
    console.error(`${sourceLabel} 수집이 이미 돌고 있습니다. 끝난 뒤 다시 실행하세요`);
    return EXIT_FAILED;
  } finally {
    await prisma.$disconnect();
  }
};
