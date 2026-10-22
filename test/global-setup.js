import 'dotenv/config';
import { execSync } from 'node:child_process';

/** 테스트 DB를 최신 마이그레이션까지 올린다. 데이터는 각 테스트가 직접 넣고 지운다 */
export default function globalSetup() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL이 없습니다. .env.example을 참고해 설정하세요.');
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
