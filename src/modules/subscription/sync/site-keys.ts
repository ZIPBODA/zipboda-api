/**
 * 지구 이름과 블록 — '시흥거모지구 S-1블록'·'(시흥거모 S-1BL)'·'고양창릉 공공주택지구 내 S-1BL'·'남양주진접2 지구 A-3블록'.
 * 지구 이름은 한글로 시작하는 한 낱말이고(주소의 앞 낱말 '거모동'과 섞이지 않게), 그 뒤에 '지구'·'공공주택지구'·'내'가
 * 띄어 붙기도 한다
 */
const SITE_PATTERN =
  /([가-힣][가-힣0-9]*)(?:\s*(?:공공주택지구|택지개발사업지구|택지개발지구|지구))?(?:\s*내)?\s*\(?\s*([A-Za-z]{1,2})\s*-?\s*(\d{1,3})\s*(?:BL|블록)/gi;

/** 낱말 끝에 붙여 쓴 지구 표시('시흥거모지구'·'고양창릉공공주택지구내') */
const DISTRICT_SUFFIX = /(?:공공주택지구|택지개발사업지구|택지개발지구|지구)?내?$/;

/** 지구 이름이 이보다 짧으면 지구가 아니다('내'·'및' 같은 조각) */
const MIN_DISTRICT_LENGTH = 2;

/**
 * 블록 앞에 오지만 지구가 아닌 낱말 — 단지 번호('4단지 A3'), 공급 유형('영구임대 A16'), 사업 이름('도시개발사업 내 A1'),
 * 여러 곳에 있는 이름('테크노밸리')은 다른 공고와 우연히 겹친다(2026-11-10 개발 DB의 LH 단지에서 확인)
 */
const GENERIC_DISTRICT = /^(?:공동|테크노밸리|신혼희망타운)$|(?:단지|임대|주택|사업)$/;

/**
 * 공고명·단지 이름·주소에서 뽑은 '지구|블록' 열쇠(ERD §5 규칙 19). LH와 청약홈은 같은 공고를 다른 이름으로 올리지만('시흥거모
 * S-1블록 공공분양주택 입주자모집공고' ↔ '시흥거모지구 S-1블록 공공분양(본청약)') 지구·블록은 같다. 블록 번호의 앞 0과 '-'는
 * 떼고('S-01' → 'S1'), 블록만으로는 다른 지구가 함께 걸려(안산신길2 A-6·시흥거모 A-6) 지구까지 묶는다
 */
export const siteKeysOf = (texts: readonly (string | null)[]): Set<string> => {
  const keys = new Set<string>();
  for (const text of texts) {
    if (text === null) continue;
    for (const match of text.matchAll(SITE_PATTERN)) {
      const district = match[1].replace(DISTRICT_SUFFIX, '');
      if (district.length < MIN_DISTRICT_LENGTH || GENERIC_DISTRICT.test(district)) continue;
      keys.add(`${district}|${match[2].toUpperCase()}${Number(match[3])}`);
    }
  }
  return keys;
};

/** 공고 하나의 지구·블록 열쇠 — 공고명에서 뽑은 것과 단지 이름·주소까지 넣은 것 */
export interface NoticeSiteKeys {
  title: Set<string>;
  all: Set<string>;
}

export const noticeSiteKeysOf = (
  title: string,
  complexes: readonly ({ name: string; address: string | null } | null)[],
): NoticeSiteKeys => {
  const titleKeys = siteKeysOf([title]);
  const complexKeys = siteKeysOf(
    complexes.flatMap((complex) => (complex === null ? [] : [complex.name, complex.address])),
  );
  return { title: titleKeys, all: new Set([...titleKeys, ...complexKeys]) };
};

const overlaps = (a: Set<string>, b: Set<string>): boolean => [...a].some((key) => b.has(key));

/**
 * 두 공고가 같은 현장인지 — 어느 한쪽 공고명의 지구·블록이 다른 쪽(공고명·단지·주소)에 있어야 한다. 단지 주소끼리만 겹치는
 * 것은 여러 블록을 모은 예비입주자 공고가 다른 공고와 우연히 겹칠 수 있어 같은 현장으로 보지 않는다
 */
export const sharesSite = (a: NoticeSiteKeys, b: NoticeSiteKeys): boolean =>
  overlaps(a.title, b.all) || overlaps(a.all, b.title);
