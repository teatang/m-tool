/**
 * ============================================================================
 * 密码学与安全工具模块（基于标准 Web Crypto API）
 * 说明：提供 HMAC-SHA256 签名与验签、常量时间字符串比较、管理员会话令牌生成与校验
 * ============================================================================
 */

import type { Env } from '../types';

/** 管理员会话 默认有效期：24 小时（单位：毫秒） */
export const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 将字节数组转换为小写十六进制字符串
 * @param bytes 字节数组
 * @returns 十六进制字符串
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 将十六进制字符串解析为字节数组；若格式非法则返回 null
 * @param hex 十六进制字符串
 * @returns Uint8Array 或 null
 */
export function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

/**
 * 计算字符串的 SHA-256 摘要（十六进制）
 * @param text 输入文本
 * @returns SHA-256 十六进制字符串
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * 解析当前可用的签名密钥
 * 优先使用环境变量 `AUTH_SECRET`；若未单独设置，则基于 `ADMIN_PASSWORD` 通过域分离哈希派生密钥，
 * 从而让用户仅需配置一个 `ADMIN_PASSWORD` 即可完成安全部署。
 *
 * @param env Worker 环境变量
 * @returns 签名密钥字符串
 */
export async function resolveSigningSecret(
  env: Pick<Env, 'ADMIN_PASSWORD' | 'AUTH_SECRET'>,
): Promise<string> {
  const explicitSecret = env.AUTH_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }
  const adminPassword = env.ADMIN_PASSWORD?.trim();
  if (adminPassword) {
    return sha256Hex(`cf-order-upload:derived-signing-secret:v1:${adminPassword}`);
  }
  throw new Error('服务器未配置 ADMIN_PASSWORD 或 AUTH_SECRET 环境变量');
}

/**
 * 使用 HMAC-SHA256 对消息进行签名，返回十六进制签名串
 * @param secret 密钥
 * @param message 待签名消息
 * @returns HMAC-SHA256 十六进制签名
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * 常量时间字节数组比较（防止时序侧信道攻击）
 * @param a 字节数组 A
 * @param b 字节数组 B
 * @returns 是否完全一致
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * 常量时间字符串比较（用于管理员密码比对）
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns 是否完全一致
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  if (bytesA.length !== bytesB.length) {
    // 即使长度不同也执行一次空循环以减少长度差异泄露
    let dummy = 0;
    for (let i = 0; i < bytesA.length; i++) {
      dummy |= bytesA[i] ^ bytesA[i];
    }
    return dummy !== 0 ? false : false;
  }
  return timingSafeEqualBytes(bytesA, bytesB);
}

/**
 * 验证 HMAC-SHA256 十六进制签名是否合法
 * @param secret 密钥
 * @param message 原始消息
 * @param signatureHex 待校验的十六进制签名
 * @returns 签名是否有效
 */
export async function verifyHmacSha256Hex(
  secret: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const providedBytes = hexToBytes(signatureHex);
  if (!providedBytes) {
    return false;
  }
  const expectedHex = await hmacSha256Hex(secret, message);
  const expectedBytes = hexToBytes(expectedHex);
  if (!expectedBytes) {
    return false;
  }
  return timingSafeEqualBytes(providedBytes, expectedBytes);
}

/**
 * 生成管理员会话 Token（格式：`nonce.expiresAtMs.signatureHex`）
 * @param secret 签名密钥
 * @param ttlMs 有效期（毫秒），默认 24 小时
 * @param nowMs 当前时间戳（毫秒），便于单元测试注入
 * @returns 签名后的会话 Token
 */
export async function createAdminSessionToken(
  secret: string,
  ttlMs: number = ADMIN_SESSION_TTL_MS,
  nowMs: number = Date.now(),
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const expiresAtMs = nowMs + ttlMs;
  const payload = `admin:${nonce}:${expiresAtMs}`;
  const signature = await hmacSha256Hex(secret, payload);
  return `${nonce}.${expiresAtMs}.${signature}`;
}

/**
 * 校验管理员会话 Token 的签名与有效期
 * @param secret 签名密钥
 * @param token 会话 Token
 * @param nowMs 当前时间戳（毫秒），便于单元测试注入
 * @returns 是否通过校验
 */
export async function verifyAdminSessionToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token || typeof token !== 'string') {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  const [nonce, expStr, signature] = parts;
  if (!nonce || !/^\d+$/.test(expStr) || !signature) {
    return false;
  }
  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
    return false;
  }
  const payload = `admin:${nonce}:${expiresAtMs}`;
  return verifyHmacSha256Hex(secret, payload, signature);
}
