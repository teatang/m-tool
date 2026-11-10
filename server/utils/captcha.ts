/**
 * ============================================================================
 * 本地图形验证码 (SVG Captcha) 生成与无状态签名校验模块
 * 说明：
 * 1. 仅使用 Web Crypto API 与纯字符串 SVG 生成验证码图片，无需任何外部第三方服务或 Node 原生字体库；
 * 2. 获取验证码 (GET /api/captcha) 完全无状态，不消耗 D1 数据库写入次数；
 * 3. 提交表单时校验证明签名、过期时间与输入字符，并通过 D1 `used_captchas` 表防止同一验证码被重放复用。
 * ============================================================================
 */

import { hmacSha256Hex, verifyHmacSha256Hex } from './crypto';

/** 验证码有效时长：5 分钟（单位：毫秒） */
export const CAPTCHA_TTL_MS = 5 * 60 * 1000;

/** 验证码字符集（剔除易混淆的 0/O、1/I/L） */
export const CAPTCHA_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 验证码长度：4 位 */
export const CAPTCHA_LENGTH = 4;

/** 字符渲染可选深色系调色板（保证浅色背景下的高可读性） */
const CHAR_COLORS = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1'];

/** 干扰线可选浅色系调色板 */
const LINE_COLORS = ['#93c5fd', '#5eead4', '#c4b5fd', '#fcd34d', '#fda4af'];

/**
 * 图形验证码生成结果
 */
export interface GeneratedCaptcha {
  /** 验证码唯一 ID */
  captchaId: string;
  /** 过期毫秒时间戳 */
  expiresAt: number;
  /** 签名校验凭证（前端提交表单时需原样回传） */
  token: string;
  /** SVG Data URL（可直接绑定到 `<img :src="..." />`） */
  imageDataUrl: string;
  /** 原始 SVG 字符串 */
  svg: string;
}

/**
 * 图形验证码校验结果
 */
export interface CaptchaVerifyResult {
  valid: boolean;
  captchaId?: string;
  expiresAt?: number;
  reason?: string;
}

/**
 * 使用密码学安全随机数生成指定范围内的整数 [min, max]
 */
function randomInt(min: number, max: number): number {
  const range = max - min + 1;
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return min + (array[0] % range);
}

/**
 * 生成随机验证码文本
 * @param length 字符长度，默认 4
 * @returns 随机大写字符串
 */
export function generateCaptchaCode(length: number = CAPTCHA_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, CAPTCHA_CHARSET.length - 1);
    code += CAPTCHA_CHARSET[idx];
  }
  return code;
}

/**
 * 将 UTF-8 字符串安全编码为 Base64
 * @param str 原始字符串
 * @returns Base64 字符串
 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 根据验证码文本绘制带干扰曲线与随机旋转的 SVG 矢量图
 * @param code 验证码文本
 * @returns 完整 SVG XML 字符串
 */
export function renderCaptchaSvg(code: string): string {
  const width = 136;
  const height = 44;

  // 1. 生成 4 条二次贝塞尔干扰曲线
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const x1 = randomInt(0, 25);
    const y1 = randomInt(4, height - 4);
    const cx = randomInt(35, width - 35);
    const cy = randomInt(2, height - 2);
    const x2 = randomInt(width - 25, width);
    const y2 = randomInt(4, height - 4);
    const color = LINE_COLORS[randomInt(0, LINE_COLORS.length - 1)];
    lines.push(
      `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" stroke="${color}" stroke-width="1.4" fill="none" opacity="0.75"/>`,
    );
  }

  // 2. 生成 18 个随机干扰噪点
  const dots: string[] = [];
  for (let i = 0; i < 18; i++) {
    const cx = randomInt(4, width - 4);
    const cy = randomInt(4, height - 4);
    const r = (randomInt(8, 16) / 10).toFixed(1);
    const color = LINE_COLORS[randomInt(0, LINE_COLORS.length - 1)];
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.7"/>`);
  }

  // 3. 逐个渲染验证码字符，加入位置抖动与旋转角度
  const chars: string[] = [];
  const step = (width - 24) / code.length;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const x = Math.round(16 + i * step + randomInt(-2, 3));
    const y = randomInt(29, 34);
    const rotate = randomInt(-18, 18);
    const color = CHAR_COLORS[randomInt(0, CHAR_COLORS.length - 1)];
    chars.push(
      `<text x="${x}" y="${y}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="24" font-weight="700" transform="rotate(${rotate} ${x} ${y - 6})">${ch}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#f8fafc"/>',
    '<stop offset="100%" stop-color="#eef2ff"/>',
    '</linearGradient>',
    '</defs>',
    `<rect width="${width}" height="${height}" rx="6" fill="url(#bg)" stroke="#dbeafe" stroke-width="1"/>`,
    ...lines,
    ...dots,
    ...chars,
    '</svg>',
  ].join('');
}

/**
 * 创建一组新的图形验证码及签名凭证
 * @param secret HMAC 签名密钥
 * @param nowMs 当前毫秒时间戳
 * @param overrideCode 可选固定验证码文本（仅用于单元测试确定性验证）
 * @returns 生成的验证码对象
 */
export async function createCaptcha(
  secret: string,
  nowMs: number = Date.now(),
  overrideCode?: string,
): Promise<GeneratedCaptcha> {
  const captchaId = crypto.randomUUID().replace(/-/g, '');
  const code = (overrideCode ?? generateCaptchaCode()).toUpperCase();
  const expiresAt = nowMs + CAPTCHA_TTL_MS;
  const payload = `captcha:${captchaId}:${code}:${expiresAt}`;
  const signature = await hmacSha256Hex(secret, payload);
  const token = `${captchaId}.${expiresAt}.${signature}`;
  const svg = renderCaptchaSvg(code);
  const imageDataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;

  return {
    captchaId,
    expiresAt,
    token,
    imageDataUrl,
    svg,
  };
}

/**
 * 校验用户输入的验证码与签名 Token 是否匹配且未过期
 * @param secret HMAC 签名密钥
 * @param token 前端传回的验证码签名凭证
 * @param userInput 用户输入的验证码字符（忽略前后空格与大小写）
 * @param nowMs 当前毫秒时间戳
 * @returns 校验结果
 */
export async function verifyCaptchaToken(
  secret: string,
  token: string,
  userInput: string,
  nowMs: number = Date.now(),
): Promise<CaptchaVerifyResult> {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: '验证码凭证缺失，请刷新验证码后重试' };
  }
  const normalizedInput = typeof userInput === 'string' ? userInput.trim().toUpperCase() : '';
  if (!normalizedInput) {
    return { valid: false, reason: '请输入图形验证码' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: '验证码凭证格式无效，请刷新后重试' };
  }

  const [captchaId, expStr, signature] = parts;
  if (!captchaId || !/^\d+$/.test(expStr) || !signature) {
    return { valid: false, reason: '验证码凭证损坏，请刷新后重试' };
  }

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) {
    return { valid: false, reason: '图形验证码已过期，请点击图片刷新' };
  }

  const payload = `captcha:${captchaId}:${normalizedInput}:${expiresAt}`;
  const isValid = await verifyHmacSha256Hex(secret, payload, signature);
  if (!isValid) {
    return { valid: false, reason: '图形验证码输入错误，请重新输入' };
  }

  return {
    valid: true,
    captchaId,
    expiresAt,
  };
}

/**
 * 在 D1 中原子标记验证码已被消费，防止同一验证码在 5 分钟有效期内被重放提交
 * @param db Cloudflare D1 数据库实例
 * @param captchaId 验证码 ID
 * @param expiresAt 过期毫秒时间戳
 * @param nowMs 当前毫秒时间戳
 * @returns true 表示首次消费成功；false 表示该验证码已被使用过
 */
export async function consumeCaptchaOnce(
  db: D1Database,
  captchaId: string,
  expiresAt: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    // 顺带清理已过期的历史防重放记录，控制表体积
    await db
      .prepare('DELETE FROM used_captchas WHERE expires_at < ?1')
      .bind(nowMs)
      .run();

    const result = await db
      .prepare('INSERT INTO used_captchas (id, expires_at) VALUES (?1, ?2)')
      .bind(captchaId, expiresAt)
      .run();

    return Boolean(result.success);
  } catch {
    // 主键冲突（UNIQUE constraint failed）说明该验证码已被消费过
    return false;
  }
}
