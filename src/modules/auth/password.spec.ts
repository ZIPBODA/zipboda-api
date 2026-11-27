import { hashPassword, verifyPassword } from './password.js';

describe('비밀번호 해시', () => {
  it('argon2id로 해시하고, 맞는 비밀번호만 통과한다', async () => {
    const passwordHash = await hashPassword('Zipboda!2026');
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(passwordHash).not.toContain('Zipboda!2026');
    await expect(verifyPassword(passwordHash, 'Zipboda!2026')).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'zipboda!2026')).resolves.toBe(false);
  });
});
