/**
 * 청약홈 공고를 한 번 수집한다(`pnpm sync:applyhome`). 사업주체가 LH·SH·GH·iH인 수도권 공고만 주택형·경쟁률을 부른다.
 * LH 수집(`pnpm sync:lh`)을 먼저 돌려야 LH API에도 있는 공고가 새로 생기지 않고 LH 공고에 이어진다(ERD §5 규칙 19)
 */
import 'dotenv/config';
import { runSyncCommand } from '../sync-cli.js';
import { ApplyhomeApiClient } from './applyhome-api.client.js';
import { ApplyhomeSyncRunner } from './applyhome-sync-runner.js';

process.exitCode = await runSyncCommand({
  command: 'sync:applyhome',
  sourceLabel: '청약홈',
  createRunner: (deps, serviceKey) =>
    new ApplyhomeSyncRunner({ ...deps, applyhome: new ApplyhomeApiClient(serviceKey) }),
});
