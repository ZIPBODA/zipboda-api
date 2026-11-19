import { correctionBatchesOf, processInPool } from './sync-run-steps.js';

interface Row {
  key: string;
  title?: string;
}

const keyOf = (row: Row) => ({ title: row.title, sourceKey: row.key });
const keysOf = (batches: Row[][]) => batches.map((batch) => batch.map((row) => row.key));

describe('정정 묶음 순서(correctionBatchesOf)', () => {
  // LH 목록은 최신순이라 정정본이 원 공고보다 먼저 온다
  it('정정 표시를 뗀 이름이 같은 공고를 모아 원 공고 → 정정 단계 → 공고번호 순으로 세운다', () => {
    const rows: Row[] = [
      { key: '03:0488', title: '[정정공고][인천지역본부] 일반 매입임대' },
      { key: '03:0500', title: '서울번동3 행복주택' },
      { key: '03:0449', title: '[정정공고][인천지역본부] 일반 매입임대' },
      { key: '03:0442', title: '[인천지역본부] 일반 매입임대' },
      { key: '03:0460', title: '[정정공고][정정공고][인천지역본부] 일반 매입임대' },
    ];
    expect(keysOf(correctionBatchesOf(rows, keyOf))).toEqual([
      ['03:0442', '03:0449', '03:0488', '03:0460'],
      ['03:0500'],
    ]);
  });

  it('이름이 없으면 혼자 묶음이다', () => {
    const rows: Row[] = [
      { key: 'b', title: '서울번동3 행복주택' },
      { key: 'c' },
      { key: 'a', title: '서울번동3 행복주택' },
      { key: 'd' },
    ];
    expect(keysOf(correctionBatchesOf(rows, keyOf))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

describe('일꾼 풀(processInPool)', () => {
  it('시간 한도를 넘으면 시작하지 못한 일을 돌려준다', async () => {
    const done: number[] = [];
    let calls = 0;
    const left = await processInPool(
      [1, 2, 3, 4],
      { concurrency: 1, overBudget: () => calls >= 2, log: () => undefined },
      (item) => {
        calls += 1;
        done.push(item);
        return Promise.resolve();
      },
    );
    expect(done).toEqual([1, 2]);
    expect(left).toEqual([3, 4]);
  });
});
