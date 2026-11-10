/**
 * ============================================================================
 * 图形验证码 API 路由模块
 * 路由：GET /api/captcha
 * ============================================================================
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { createCaptcha } from '../utils/captcha';
import { resolveSigningSecret } from '../utils/crypto';

export const captchaRoutes = new Hono<{ Bindings: Env }>();

/**
 * 获取一张新的本地 SVG 图形验证码及对应的签名校验凭证
 * 说明：设置 `Cache-Control: no-store` 防止浏览器或 CDN 缓存旧验证码图片
 */
captchaRoutes.get('/', async (c) => {
  const secret = await resolveSigningSecret(c.env);
  const captcha = await createCaptcha(secret);

  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return c.json({
    captcha_id: captcha.captchaId,
    expires_at: captcha.expiresAt,
    token: captcha.token,
    image_data_url: captcha.imageDataUrl,
  });
});
