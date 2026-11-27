import { randomBytes } from 'node:crypto';
import { PiiCipher } from './pii-cipher.js';

describe('개인정보 암호화', () => {
  const cipher = new PiiCipher(randomBytes(32), randomBytes(32));

  it('암호화한 값을 되돌리면 원래 글자다', () => {
    expect(cipher.decrypt(cipher.encrypt('홍길동'))).toBe('홍길동');
    expect(cipher.decrypt(cipher.encrypt(''))).toBe('');
  });

  it('같은 값도 매번 다른 암호문이 된다(IV가 매번 새로)', () => {
    expect(Buffer.from(cipher.encrypt('01012345678')).equals(Buffer.from(cipher.encrypt('01012345678')))).toBe(false);
  });

  it('암호문 앞에 키 버전 1을 싣는다', () => {
    expect(cipher.encrypt('홍길동')[0]).toBe(1);
  });

  it('바뀐 암호문·다른 키·모르는 키 버전·너무 짧은 값은 읽지 않고 실패한다', () => {
    const sealed = cipher.encrypt('홍길동');
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => cipher.decrypt(tampered)).toThrow();

    expect(() => new PiiCipher(randomBytes(32), randomBytes(32)).decrypt(sealed)).toThrow();

    const unknownVersion = Uint8Array.from(sealed);
    unknownVersion[0] = 2;
    expect(() => cipher.decrypt(unknownVersion)).toThrow(/키 버전 2/);

    expect(() => cipher.decrypt(new Uint8Array(10))).toThrow(/너무 짧/);
  });

  it('찾기용 HMAC은 같은 값이면 같고 키가 다르면 다르다', () => {
    expect(cipher.hash('01012345678')).toBe(cipher.hash('01012345678'));
    expect(cipher.hash('01012345678')).not.toBe(cipher.hash('01012345679'));
    expect(new PiiCipher(randomBytes(32), randomBytes(32)).hash('01012345678')).not.toBe(cipher.hash('01012345678'));
  });
});
