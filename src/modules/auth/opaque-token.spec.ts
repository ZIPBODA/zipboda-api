import { hashOpaqueToken, newOpaqueToken } from './opaque-token.js';

describe('무작위 토큰', () => {
  it('매번 다른 43자 토큰을 만들고, 해시는 토큰에서 다시 계산할 수 있다', () => {
    const first = newOpaqueToken();
    const second = newOpaqueToken();
    expect(first.token).toHaveLength(43);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashOpaqueToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
  });
});
