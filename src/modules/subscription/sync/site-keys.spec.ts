import { noticeSiteKeysOf, sharesSite, siteKeysOf } from './site-keys.js';

const keysOf = (...texts: string[]) => [...siteKeysOf(texts)].sort();

describe('지구·블록 열쇠(ERD §5 규칙 19)', () => {
  it.each([
    // [LH 공고명·단지 주소, 청약홈 공고명·공급 위치] — 2026-11-10 실데이터에서 같은 공고로 확인한 쌍
    ['[정정공고]시흥거모 S-1블록 공공분양주택 입주자모집공고', '시흥거모지구 S-1블록 공공분양(본청약)'],
    ['남양주왕숙 B-17블록 공공분양주택 입주자모집공고', '남양주왕숙지구 B-17블록 공공분양주택(본청약)'],
    [
      '남양주진접2 A-3블록 신혼희망타운(공공분양) 입주자모집공고',
      '남양주진접2 지구 A-3블록 신혼희망타운(공공분양)(본청약)',
    ],
    ['의정부우정 A-2블록 공공분양주택 입주자모집공고', '의정부우정 A2블록 공공분양주택(본청약)'],
    ['[정정공고]양주회천 A-26BL 공공분양주택 입주자모집공고', '양주회천지구 A-26블록 공공분양주택'],
    [
      '[정정공고][정정공고]역곡지구 하우스토리(부천역곡 A-2블록) 신혼희망타운(공공분양) 입주자모집공고',
      '역곡지구 하우스토리(부천역곡지구 A-2BL) 신혼희망타운(공공분양)(본청약)',
    ],
    [
      '[정정공고]e편한세상 분당 퍼스트빌리지(성남낙생 A-1BL) 신혼희망타운(공공분양) 입주자모집공고',
      'e편한세상 분당 퍼스트빌리지(성남낙생지구 A-1BL) 신혼희망타운(공공분양)(본청약)',
    ],
    [
      '경기도 고양시 덕양구 행신동 고양창릉지구 내 S-1블록',
      '경기도 고양시 덕양구 행신동 313번지 일원 고양창릉 공공주택지구 내 S-1BL',
    ],
  ])('%s ↔ %s', (lh, applyhome) => {
    const shared = keysOf(lh).filter((key) => siteKeysOf([applyhome]).has(key));
    expect(shared).toHaveLength(1);
  });

  it('블록이 같아도 지구가 다르면 다른 열쇠다', () => {
    expect(keysOf('안산신길2 A-6블록 신혼희망타운(공공분양)')).toEqual(['안산신길2|A6']);
    expect(keysOf('시흥 거모 아테라(시흥거모 A-6BL) 신혼희망타운(공공분양)')).toEqual(['시흥거모|A6']);
  });

  it('주소 앞의 동 이름을 지구로 읽지 않고, 블록 번호의 앞 0을 뗀다', () => {
    expect(keysOf('경기도 시흥시 거모동 시흥거모 S-1BL')).toEqual(['시흥거모|S1']);
    expect(keysOf('고양창릉 S-01블록')).toEqual(['고양창릉|S1']);
  });

  it('블록이 없는 이름·주소는 열쇠가 없다', () => {
    expect(
      keysOf('고양 창릉 우미 린 그레니티 공공분양주택(본청약)', '경기도 수원시 영통구 원천동 633번지 일원'),
    ).toEqual([]);
  });

  it('단지 번호·공급 유형·사업 이름·흔한 이름은 지구로 읽지 않는다', () => {
    expect(keysOf('화성남양뉴타운 4단지 A3블록')).toEqual([]);
    expect(keysOf('양주옥정 영구임대 A16블록', '인천검단 국민임대 AA19블록')).toEqual([]);
    expect(keysOf('안양 관양고 주변 도시개발사업 내 A1BL')).toEqual([]);
    expect(keysOf('인천계양 테크노밸리 A6블록')).toEqual([]);
    expect(keysOf('화성남양뉴타운 A3블록')).toEqual(['화성남양뉴타운|A3']);
  });

  it('어느 한쪽 공고명의 지구·블록이 있어야 같은 현장이다 — 단지 주소끼리만 겹치면 아니다', () => {
    const lh = noticeSiteKeysOf('[정정공고]시흥거모 S-1블록 공공분양주택 입주자모집공고', [
      { name: '시흥거모(공공주택) S-1', address: '경기도 시흥시 거모동 시흥거모 S-1BL' },
    ]);
    const applyhome = noticeSiteKeysOf('시흥거모지구 S-1블록 공공분양(본청약)', [
      {
        name: '시흥거모지구 S-1블록 공공분양',
        address: '경기도 시흥시 거모동, 군자동 일원 시흥거모 공공주택지구 내 S-1블록',
      },
    ]);
    expect(sharesSite(applyhome, lh)).toBe(true);

    const reserve = noticeSiteKeysOf('2026년 경기도 영구임대주택 예비입주자 모집', [
      { name: '시흥거모 S-1', address: '경기도 시흥시 거모동 시흥거모 S-1BL' },
    ]);
    const unnamed = noticeSiteKeysOf('시흥 어느 공공분양 입주자모집', [
      { name: '어느 공공분양', address: '경기도 시흥시 거모동 시흥거모 S-1BL' },
    ]);
    expect(sharesSite(unnamed, reserve)).toBe(false);
  });
});
