import base from './jest.config.js';

// e2e는 실제 DB(TEST_DATABASE_URL)에 붙는다. 마이그레이션은 globalSetup이 먼저 올린다
/** @type {import('jest').Config} */
export default {
  ...base,
  roots: ['<rootDir>/test'],
  testRegex: '\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/test/use-test-database.js'],
  globalSetup: '<rootDir>/test/global-setup.js',
};
