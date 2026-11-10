import { databaseLabelOf, parseSyncLhArgs } from './sync-lh.args.js';

/** 한국 날짜로는 2026-11-10(UTC로는 아직 11-09) */
const NOW = new Date('2026-11-09T16:00:00Z');

describe('pnpm sync:lh 인자', () => {
  it('날짜를 주지 않으면 한국 날짜 기준 1년 전 달 초부터 오늘까지, 지오코딩은 켠다', () => {
    expect(parseSyncLhArgs([], NOW)).toEqual({
      ok: true,
      args: { from: '20251101', to: '20261110', full: false, geocode: true },
    });
  });

  it('범위·전체 다시 받기·지오코딩 끄기를 받는다', () => {
    expect(parseSyncLhArgs(['--from=20260101', '--to=20260331', '--full', '--no-geocode'], NOW)).toEqual({
      ok: true,
      args: { from: '20260101', to: '20260331', full: true, geocode: false },
    });
  });

  it('없는 날짜·형식이 다른 날짜·뒤집힌 범위·모르는 인자는 거절한다', () => {
    for (const argv of [['--from=20260230'], ['--to=2026-03-01'], ['--from=20260401', '--to=20260301'], ['--fast']]) {
      expect(parseSyncLhArgs(argv, NOW)).toMatchObject({ ok: false });
    }
  });

  it('DB 주소는 비밀번호 없이 호스트·DB 이름만 보이고, 읽지 못하는 주소도 그대로 내보내지 않는다', () => {
    expect(databaseLabelOf('postgresql://zipboda:s3cret@localhost:5433/zipboda?schema=public')).toBe(
      'localhost:5433/zipboda',
    );
    const unreadable = 'postgresql://zipboda:pa#ss@localhost:5433/zipboda';
    expect(databaseLabelOf(unreadable)).not.toContain('pa#ss');
  });
});
