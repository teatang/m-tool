/**
 * ============================================================================
 * 本地图形验证码生成、校验与 D1 防重放单元测试 (server/utils/captcha.ts)
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  CAPTCHA_CHARSET,
  CAPTCHA_LENGTH,
  CAPTCHA_TTL_MS,
  consumeCaptchaOnce,
  createCaptcha,
  generateCaptchaCode,
  renderCaptchaSvg,
  verifyCaptchaToken,
} from '../../server/utils/captcha';
import { createMockD1Database } from '../helpers/mockD1';

describe('server/utils/captcha', () => {
  it('generateCaptchaCode 生成固定长度且排除易混淆字符的代码', () => {
    for (let i = 0; i < 30; i++) {
      const code = generateCaptchaCode();
      expect(code).toHaveLength(CAPTCHA_LENGTH);
      for (const ch of code) {
        expect(CAPTCHA_CHARSET.includes(ch)).toBe(true);
        expect(['0', 'O', '1', 'I', 'L']).not.toContain(ch);
      }
    }
  });

  it('renderCaptchaSvg 与 createCaptcha 返回有效 SVG 和 Base64 Data URL', async () => {
    const svg = renderCaptchaSvg('A8K9');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('>A<');
    expect(svg).toContain('>8<');

    const captcha = await createCaptcha('secret-key', 1_700_000_000_000, 'B7M4');
    expect(captcha.captchaId).toHaveLength(32);
    expect(captcha.expiresAt).toBe(1_700_000_000_000 + CAPTCHA_TTL_MS);
    expect(captcha.imageDataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('verifyCaptchaToken 忽略大小写与首尾空格，并拦截错误/过期/篡改验证码', async () => {
    const secret = 'captcha-secret';
    const now = 1_700_000_000_000;
    const captcha = await createCaptcha(secret, now, 'K9P2');

    // 小写 + 空格均应验证通过
    const ok = await verifyCaptchaToken(secret, captcha.token, ' k9p2 ', now + 5000);
    expect(ok.valid).toBe(true);
    expect(ok.captchaId).toBe(captcha.captchaId);

    // 字符错误
    const wrong = await verifyCaptchaToken(secret, captcha.token, 'XXXX', now + 5000);
    expect(wrong.valid).toBe(false);

    // 超时过期
    const expired = await verifyCaptchaToken(
      secret,
      captcha.token,
      'K9P2',
      now + CAPTCHA_TTL_MS + 1,
    );
    expect(expired.valid).toBe(false);
    expect(expired.reason).toContain('过期');

    // 篡改过期时间延长有效期应被 HMAC 拦截
    const parts = captcha.token.split('.');
    const forgedToken = `${parts[0]}.${now + 999_999_999}.${parts[2]}`;
    const tampered = await verifyCaptchaToken(secret, forgedToken, 'K9P2', now + 5000);
    expect(tampered.valid).toBe(false);
  });

  it('consumeCaptchaOnce 在 D1 中保证验证码仅可消费一次，防止重放攻击', async () => {
    const db = await createMockD1Database();
    const now = 1_700_000_000_000;

    // 预先插入一条已过期的历史记录验证顺带清理逻辑
    await db
      .prepare('INSERT INTO used_captchas (id, expires_at) VALUES (?1, ?2)')
      .bind('old-expired-id', now - 1000)
      .run();

    const firstTry = await consumeCaptchaOnce(db, 'cap-123', now + 60_000, now);
    expect(firstTry).toBe(true);

    // 同一 captchaId 二次重放必须被拒绝
    const replayTry = await consumeCaptchaOnce(db, 'cap-123', now + 60_000, now + 1000);
    expect(replayTry).toBe(false);

    // 过期记录已被自动清理
    const expiredRow = await db
      .prepare('SELECT id FROM used_captchas WHERE id = ?1')
      .bind('old-expired-id')
      .first();
    expect(expiredRow).toBeNull();
  });
});
