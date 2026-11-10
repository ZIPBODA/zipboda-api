/**
 * LH 공고를 한 번 수집한다(API-114의 수동 실행 전 단계). 관리자 화면·예약 실행이 생기기 전까지 개발 DB를 채우는 데 쓴다.
 * 상세·공급정보 API는 하루 1만 건 한도라, 바뀌지 않은 공고는 다시 부르지 않는다(--full이면 모두 다시 부른다)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/database/generated/client.js';
import { SyncStatus, SyncTrigger } from '../../constants.js';
import { KakaoGeocoder } from '../geocode/kakao-geocoder.js';
import { NoticeWriter } from '../notice-writer.js';
import { SyncAlreadyRunningError, SyncRunRecorder } from '../sync-run-recorder.js';
import { LhApiClient } from './lh-api.client.js';
import { LhSyncRunner, type LhSyncSummary } from './lh-sync-runner.js';
import { databaseLabelOf, parseSyncLhArgs, SYNC_LH_USAGE } from './sync-lh.args.js';

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const summaryLines = (summary: LhSyncSummary): string[] => [
  `결과 ${summary.status} (실행 ${summary.runId})`,
  `목록 ${summary.listed}건 · 받음 ${summary.fetched}건 · 바뀌지 않아 건너뜀 ${summary.skipped}건 · 시간 한도로 다음 실행에 넘김 ${summary.deferred}건`,
  `새 공고 ${summary.created}건 · 갱신 ${summary.updated}건 · 정정 묶음 참조 ${summary.referenced}건`,
  `수집 범위 밖 ${summary.excluded}건 · 분류표에 없음 ${summary.unclassified}건 · 실패 ${summary.failed}건 · 경고 ${summary.warnings}건`,
  `좌표 ${summary.geocoded}건 · 주소로 못 찾음 ${summary.notFound}건${summary.geocodeStopped === null ? '' : ` · 좌표 찾기 멈춤(${summary.geocodeStopped})`}`,
];

const main = async (): Promise<number> => {
  const parsed = parseSyncLhArgs(process.argv.slice(2), new Date());
  if (!parsed.ok) {
    console.error(`${parsed.reason}\n사용법: ${SYNC_LH_USAGE}`);
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

  console.log(`DB ${databaseLabelOf(databaseUrl)} · 게시일 ${from}~${to}${full ? ' · 모두 다시 받기' : ''}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const runner = new LhSyncRunner({
      prisma,
      lh: new LhApiClient(serviceKey),
      writer: new NoticeWriter(prisma),
      recorder: new SyncRunRecorder(prisma),
      geocoder: kakaoKey ? new KakaoGeocoder(kakaoKey) : null,
      now: () => new Date(),
      log: (message) => console.log(message),
    });
    const summary = await runner.run({ trigger: SyncTrigger.CLI, from, to, full });
    console.log(summaryLines(summary).join('\n'));
    if (summary.failed > 0 || summary.warnings > 0) console.log('실패·경고는 sync_failures(미해결)에서 확인합니다');
    return summary.status === SyncStatus.FAILED ? EXIT_FAILED : 0;
  } catch (error) {
    if (!(error instanceof SyncAlreadyRunningError)) throw error;
    console.error('LH 수집이 이미 돌고 있습니다. 끝난 뒤 다시 실행하세요');
    return EXIT_FAILED;
  } finally {
    await prisma.$disconnect();
  }
};

process.exitCode = await main();
