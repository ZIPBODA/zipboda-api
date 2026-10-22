import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7은 .env를 스스로 읽지 않는다. 주소가 없어도 generate는 돌아야 해서(설치·CI 빌드) env()가 아니라 process.env로 읽는다
export default defineConfig({
  schema: 'src/database/schema.prisma',
  migrations: {
    path: 'src/database/migrations',
    seed: 'tsx src/database/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
