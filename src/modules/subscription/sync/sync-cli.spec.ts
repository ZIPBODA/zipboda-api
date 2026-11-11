import { databaseLabelOf, parseSyncArgs, summaryLinesOf, syncUsageOf } from './sync-cli.js';

/** 한국 날짜로는 2026-11-10(UTC로는 아직 11-09) */
const NOW = new Date('2026-11-09T16:00:00Z');

describe('수집 명령 인자', () => {
  it('날짜를 주지 않으면 한국 날짜 기준 1년 전 달 초부터 오늘까지, 지오코딩은 켠다', () => {
    expect(parseSyncArgs([], NOW)).toEqual({
      ok: true,
      args: { from: '20251101', to: '20261110', full: false, geocode: true },
    });
  });

  it('범위·전체 다시 받기·지오코딩 끄기를 받는다', () => {
    expect(parseSyncArgs(['--from=20260101', '--to=20260331', '--full', '--no-geocode'], NOW)).toEqual({
      ok: true,
      args: { from: '20260101', to: '20260331', full: true, geocode: false },
    });
  });

  it('없는 날짜·형식이 다른 날짜·뒤집힌 범위·모르는 인자는 거절한다', () => {
    for (const argv of [['--from=20260230'], ['--to=2026-03-01'], ['--from=20260401', '--to=20260301'], ['--fast']]) {
      expect(parseSyncArgs(argv, NOW)).toMatchObject({ ok: false });
    }
  });

  it('DB 주소는 비밀번호 없이 호스트·DB 이름만 보이고, 읽지 못하는 주소도 그대로 내보내지 않는다', () => {
    expect(databaseLabelOf('postgresql://zipboda:s3cret@localhost:5433/zipboda?schema=public')).toBe(
      'localhost:5433/zipboda',
    );
    const unreadable = 'postgresql://zipboda:pa#ss@localhost:5433/zipboda';
    expect(databaseLabelOf(unreadable)).not.toContain('pa#ss');
  });

  it('사용법은 명령 이름을 넣어 보이고, 실행 요약은 상태·건수·좌표 멈춤 까닭을 보인다', () => {
    expect(syncUsageOf('sync:applyhome')).toBe(
      'pnpm sync:applyhome [--from=YYYYMMDD] [--to=YYYYMMDD] [--full] [--no-geocode]',
    );
    const lines = summaryLinesOf({
      runId: 'run-1',
      status: 'PARTIAL',
      listed: 1227,
      fetched: 66,
      skipped: 0,
      deferred: 0,
      created: 30,
      updated: 0,
      referenced: 36,
      excluded: 1161,
      unclassified: 0,
      failed: 1,
      warnings: 2,
      geocoded: 3,
      notFound: 1,
      geocodeStopped: 'QUOTA_EXCEEDED',
    });
    expect(lines[0]).toBe('결과 PARTIAL (실행 run-1)');
    expect(lines[2]).toBe('새 공고 30건 · 갱신 0건 · 다른 공고에 참조로 이음 36건');
    expect(lines[4]).toBe('좌표 3건 · 주소로 못 찾음 1건 · 좌표 찾기 멈춤(QUOTA_EXCEEDED)');
  });
});
