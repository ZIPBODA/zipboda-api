import 'dotenv/config';

// 앱이 읽는 DATABASE_URL을 테스트 DB로 바꿔 끼운다 — 개발 DB의 데이터를 지우지 않게
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL이 없습니다. .env.example을 참고해 설정하세요.');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
