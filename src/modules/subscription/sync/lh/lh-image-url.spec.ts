import { readFileSync } from 'node:fs';
import path from 'node:path';
import { imageInViewerPage, isLhImageViewerUrl } from './lh-image-url.js';

const PAGE = 'https://apply.lh.or.kr/lhapply/lhImageView2.do?fileid=69101985';

// 2026-11-12 LH 청약센터가 실제로 준 보기 페이지 — 정상(viewer), 없는 fileid(missing), 형식이 틀린 fileid(error). 셋 다 200이다
const page = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'lh', 'image-pages', `${name}.html`), 'utf8');

describe('LH 단지 사진 보기 페이지 주소', () => {
  it.each([
    [PAGE, true],
    ['https://apply.lh.or.kr/upload/Files/upload_dec/2026/LSE/10/22/2026102269101985.jpg', false],
    ['http://apply.lh.or.kr/lhapply/lhImageView2.do?fileid=1', false],
    ['https://evil.example/lhapply/lhImageView2.do?fileid=1', false],
    ['/housing/gangnam-gaepo/exterior.png', false],
    ['not a url', false],
  ])('%s → 보기 페이지 %s', (url, expected) => {
    expect(isLhImageViewerUrl(url)).toBe(expected);
  });
});

describe('보기 페이지가 가리키는 사진', () => {
  it('정상 페이지는 청약센터의 사진 파일 주소다', () => {
    expect(imageInViewerPage(page('viewer'), PAGE)).toEqual({
      kind: 'IMAGE',
      url: 'https://apply.lh.or.kr/upload/Files/upload_dec/2026/LSE/10/22/2026102269101985.jpg',
    });
  });

  // 파일이 없으면 src가 비고 onerror 안에만 '이미지 없음' 그림이 있다 — 그 그림을 사진으로 읽으면 영구히 남는다
  it('파일이 없다는 페이지(빈 src)는 사진 없음이다', () => {
    expect(imageInViewerPage(page('missing'), PAGE)).toEqual({ kind: 'MISSING' });
    expect(imageInViewerPage(`<img onerror="this.src='/upload/x.jpg'" src="">`, PAGE)).toEqual({ kind: 'MISSING' });
  });

  it('오류 페이지의 그림·사진 파일 경로 밖·다른 곳·http는 사진이 아니라 알 수 없는 페이지다', () => {
    expect(imageInViewerPage(page('error'), PAGE)).toEqual({ kind: 'UNEXPECTED' });
    expect(imageInViewerPage('<html><body>점검 중입니다</body></html>', PAGE)).toEqual({ kind: 'UNEXPECTED' });
    expect(imageInViewerPage('<img src="https://evil.example/upload/a.jpg">', PAGE)).toEqual({ kind: 'UNEXPECTED' });
    expect(imageInViewerPage('<img src="http://apply.lh.or.kr/upload/a.jpg">', PAGE)).toEqual({ kind: 'UNEXPECTED' });
    expect(imageInViewerPage('<img src="/upload/a.html">', PAGE)).toEqual({ kind: 'UNEXPECTED' });
    expect(imageInViewerPage('<img src=/upload/a.jpg>', PAGE)).toEqual({ kind: 'UNEXPECTED' });
  });

  it('속성 순서·data-src·대문자·작은따옴표·&amp;가 섞여도 src 값을 읽는다', () => {
    expect(
      imageInViewerPage(`<IMG data-src="/upload/lazy.jpg" alt='x' SRC='/upload/a.jpg?v=1&amp;w=2'>`, PAGE),
    ).toEqual({
      kind: 'IMAGE',
      url: 'https://apply.lh.or.kr/upload/a.jpg?v=1&w=2',
    });
  });
});
