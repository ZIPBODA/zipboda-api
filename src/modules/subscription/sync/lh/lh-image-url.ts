import { LH_IMAGE_FILE, LH_IMAGE_FILE_PATH, LH_IMAGE_SRC, LH_IMAGE_VIEWER } from './lh.constants.js';

/** LH 단지 사진 보기 페이지 주소인지 — 사진 파일이 아니라 사진을 감싼 HTML이다(ERD §5 규칙 16) */
export const isLhImageViewerUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && parsed.host === LH_IMAGE_VIEWER.host && parsed.pathname === LH_IMAGE_VIEWER.path
    );
  } catch {
    return false;
  }
};

/**
 * 보기 페이지가 가리키는 사진. IMAGE는 청약센터의 사진 파일, MISSING은 LH가 파일이 없다고 알린 페이지(`<img src="">`),
 * UNEXPECTED는 그 밖의 모든 페이지(오류·점검·차단 페이지, 모양이 바뀐 페이지) — 사진 없음으로 단정하지 않는다
 */
export type ViewerPageImage = { kind: 'IMAGE'; url: string } | { kind: 'MISSING' } | { kind: 'UNEXPECTED' };

const isLhImageFile = (url: URL): boolean =>
  url.protocol === 'https:' &&
  url.host === LH_IMAGE_VIEWER.host &&
  url.pathname.startsWith(LH_IMAGE_FILE_PATH) &&
  LH_IMAGE_FILE.test(url.pathname);

export const imageInViewerPage = (html: string, pageUrl: string): ViewerPageImage => {
  const match = LH_IMAGE_SRC.exec(html);
  if (!match) return { kind: 'UNEXPECTED' };
  const src = match[2].trim();
  if (src === '') return { kind: 'MISSING' };
  try {
    const url = new URL(src.replaceAll('&amp;', '&'), pageUrl);
    return isLhImageFile(url) ? { kind: 'IMAGE', url: url.toString() } : { kind: 'UNEXPECTED' };
  } catch {
    return { kind: 'UNEXPECTED' };
  }
};
