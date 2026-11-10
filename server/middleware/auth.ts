/**
 * ============================================================================
 * 管理员鉴权中间件与 Cookie 会话管理模块
 * 说明：
 * 1. 支持通过 HttpOnly Cookie (`admin_session`) 鉴权，确保浏览器中的 `<img src="/api/admin/files/...">`
 *    与 `<iframe src="/api/admin/files/...">` 能够自动携带会话凭证预览受保护的附件；
 * 2. 同时兼容 `Authorization: Bearer <token>` 请求头，便于脚本或自动化测试调用。
 * ============================================================================
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import {
  ADMIN_SESSION_TTL_MS,
  resolveSigningSecret,
  verifyAdminSessionToken,
} from '../utils/crypto';

/** 管理员会话 Cookie 名称 */
export const ADMIN_SESSION_COOKIE_NAME = 'admin_session';

/**
 * 从请求头 `Cookie` 中解析指定名称的 Cookie 值
 * @param cookieHeader 原始 Cookie 请求头
 * @param targetName 目标 Cookie 名称
 * @returns 解码后的 Cookie 值，不存在则返回 null
 */
export function parseCookieValue(cookieHeader: string | undefined, targetName: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    if (name === targetName) {
      const value = pair.slice(eqIndex + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * 从 Hono 请求上下文中提取管理员会话 Token（优先 Cookie，其次 Authorization Bearer）
 */
export function extractAdminToken(headers: Headers): string | null {
  const cookieToken = parseCookieValue(headers.get('Cookie') ?? undefined, ADMIN_SESSION_COOKIE_NAME);
  if (cookieToken) {
    return cookieToken;
  }
  const authHeader = headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) {
      return bearer;
    }
  }
  return null;
}

/**
 * 构造签发管理员会话的 `Set-Cookie` 响应头字符串
 * @param token 已签名的会话 Token
 * @param isHttps 当前请求是否为 HTTPS（本地 http://localhost 开发时不能加 Secure，否则浏览器不存储）
 */
export function buildSessionCookieHeader(token: string, isHttps: boolean): string {
  const maxAgeSeconds = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * 构造注销清理 Cookie 的 `Set-Cookie` 响应头字符串
 */
export function buildLogoutCookieHeader(isHttps: boolean): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * 判断请求是否处于 HTTPS 协议下（兼容 Cloudflare Workers `X-Forwarded-Proto` 与请求 URL）
 */
export function isHttpsRequest(url: string, headers: Headers): boolean {
  const forwardedProto = headers.get('X-Forwarded-Proto');
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === 'https';
  }
  return url.startsWith('https://');
}

/**
 * Hono 管理员路由鉴权中间件
 * 未通过鉴权时统一返回 401 状态码与中文提示
 */
export const requireAdminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = extractAdminToken(c.req.raw.headers);
  if (!token) {
    return c.json({ error: '未登录或登录已失效，请先登录管理后台' }, 401);
  }

  try {
    const secret = await resolveSigningSecret(c.env);
    const valid = await verifyAdminSessionToken(secret, token);
    if (!valid) {
      return c.json({ error: '登录会话已过期或无效，请重新登录' }, 401);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务器鉴权配置异常';
    return c.json({ error: message }, 500);
  }

  await next();
};
