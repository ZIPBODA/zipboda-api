/**
 * LH 공고를 한 번 수집한다(`pnpm sync:lh`). 상세·공급정보 API는 하루 1만 건 한도라, 바뀌지 않은 공고는 다시 부르지 않는다
 * (--full이면 모두 다시 부른다). 청약홈 수집(`pnpm sync:applyhome`)보다 먼저 돌려야 청약홈 공고가 LH 공고에 이어진다
 */
import 'dotenv/config';
import { runSyncCommand } from '../sync-cli.js';
import { LhApiClient } from './lh-api.client.js';
import { LhSyncRunner } from './lh-sync-runner.js';

process.exitCode = await runSyncCommand({
  command: 'sync:lh',
  sourceLabel: 'LH',
  createRunner: (deps, serviceKey) => new LhSyncRunner({ ...deps, lh: new LhApiClient(serviceKey) }),
});
