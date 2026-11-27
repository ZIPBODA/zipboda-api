import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const CURRENT_KEY_VERSION = 1;
const VERSION_BYTES = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = VERSION_BYTES + IV_BYTES + AUTH_TAG_BYTES;

/**
 * 이름·휴대폰처럼 저장할 때 암호화해야 하는 개인정보(ERD §5 규칙 21, REQ-NF-006).
 * 암호문 = 키 버전(1바이트) + IV(12) + 인증 태그(16) + 본문 — 키를 바꿔도 옛 행을 옛 키로 읽을 수 있게 버전을 앞에 싣는다
 */
export class PiiCipher {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(
    encryptionKey: Buffer,
    private readonly hashKey: Buffer,
  ) {
    this.keys = new Map([[CURRENT_KEY_VERSION, encryptionKey]]);
  }

  encrypt(plain: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keyOf(CURRENT_KEY_VERSION), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const sealed = Buffer.concat([Buffer.from([CURRENT_KEY_VERSION]), iv, cipher.getAuthTag(), body]);
    return new Uint8Array(sealed);
  }

  /** 인증 태그가 맞지 않으면(값이 바뀌었거나 다른 키) 조용히 깨진 글자를 주지 않고 실패한다 */
  decrypt(sealed: Uint8Array): string {
    const bytes = Buffer.from(sealed);
    if (bytes.length < HEADER_BYTES) throw new Error('암호문이 너무 짧습니다');
    const version = bytes.readUInt8(0);
    const iv = bytes.subarray(VERSION_BYTES, VERSION_BYTES + IV_BYTES);
    const authTag = bytes.subarray(VERSION_BYTES + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.keyOf(version), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]).toString('utf8');
  }

  /** 같은 값을 찾을 때 쓰는 HMAC. 암호화 키와 다른 키를 쓴다 */
  hash(value: string): string {
    return createHmac('sha256', this.hashKey).update(value, 'utf8').digest('hex');
  }

  private keyOf(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new Error(`암호화 키 버전 ${version}이 없습니다`);
    return key;
  }
}
