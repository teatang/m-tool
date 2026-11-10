/**
 * ============================================================================
 * 密码学与会话令牌工具单元测试 (server/utils/crypto.ts)
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  createAdminSessionToken,
  hmacSha256Hex,
  resolveSigningSecret,
  timingSafeEqualStrings,
  verifyAdminSessionToken,
  verifyHmacSha256Hex,
} from '../../server/utils/crypto';

describe('server/utils/crypto', () => {
  it('resolveSigningSecret 优先使用显式 AUTH_SECRET，其次从 ADMIN_PASSWORD 派生', async () => {
    const explicit = await resolveSigningSecret({
      AUTH_SECRET: 'custom-secret',
      ADMIN_PASSWORD: 'pwd',
    });
    expect(explicit).toBe('custom-secret');

    const derivedA = await resolveSigningSecret({ ADMIN_PASSWORD: 'pwd-1' });
    const derivedB = await resolveSigningSecret({ ADMIN_PASSWORD: 'pwd-1' });
    const derivedC = await resolveSigningSecret({ ADMIN_PASSWORD: 'pwd-2' });

    expect(derivedA).toHaveLength(64);
    expect(derivedA).toBe(derivedB);
    expect(derivedA).not.toBe(derivedC);

    await expect(resolveSigningSecret({})).rejects.toThrow('ADMIN_PASSWORD');
  });

  it('hmacSha256Hex 与 verifyHmacSha256Hex 能正确签名并拦截篡改', async () => {
    const secret = 'test-signing-key';
    const msg = 'order_no=12345&amount=99.00';
    const sig = await hmacSha256Hex(secret, msg);

    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyHmacSha256Hex(secret, msg, sig)).toBe(true);
    expect(await verifyHmacSha256Hex(secret, `${msg}x`, sig)).toBe(false);
    expect(await verifyHmacSha256Hex('wrong-key', msg, sig)).toBe(false);
    expect(await verifyHmacSha256Hex(secret, msg, 'invalid-hex!')).toBe(false);
  });

  it('timingSafeEqualStrings 准确比较等长与不等长字符串', () => {
    expect(timingSafeEqualStrings('Secret123!', 'Secret123!')).toBe(true);
    expect(timingSafeEqualStrings('Secret123!', 'Secret123?')).toBe(false);
    expect(timingSafeEqualStrings('short', 'longer-string')).toBe(false);
    expect(timingSafeEqualStrings('', '')).toBe(true);
  });

  it('createAdminSessionToken 与 verifyAdminSessionToken 支持签发与过期拦截', async () => {
    const secret = 'session-secret';
    const now = 1_700_000_000_000;
    const token = await createAdminSessionToken(secret, 60_000, now);

    // 有效期内通过
    expect(await verifyAdminSessionToken(secret, token, now + 30_000)).toBe(true);
    // 过期后失败
    expect(await verifyAdminSessionToken(secret, token, now + 60_001)).toBe(false);
    // 签名被篡改失败
    const tampered = `${token.slice(0, -4)}abcd`;
    expect(await verifyAdminSessionToken(secret, tampered, now + 1000)).toBe(false);
    // 格式非法失败
    expect(await verifyAdminSessionToken(secret, 'bad-token', now)).toBe(false);
  });
});
