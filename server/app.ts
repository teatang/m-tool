/**
 * ============================================================================
 * Cloudflare Workers Hono 应用装配模块
 * 说明：集中挂载所有 API 路由、健康检查接口、全局错误处理以及静态资源兜底转发
 * ============================================================================
 */

import { Hono } from 'hono';
import { adminRoutes } from './routes/admin';
import { captchaRoutes } from './routes/captcha';
import { submissionRoutes } from './routes/submissions';
import type { Env } from './types';

/**
 * 创建并配置 Hono 应用实例（抽离为工厂函数，方便单元测试直接传入 Mock Env 测试）
 */
export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // 健康检查接口：确认 Worker 运行状态及 D1 数据库连通性
  app.get('/api/health', async (c) => {
    try {
      await c.env.DB.prepare('SELECT 1 AS ok').first();
      return c.json({ status: 'ok', database: 'connected' });
    } catch {
      return c.json({ status: 'error', database: 'disconnected' }, 500);
    }
  });

  // 挂载业务接口路由
  app.route('/api/captcha', captchaRoutes);
  app.route('/api/submissions', submissionRoutes);
  app.route('/api/admin', adminRoutes);

  // 未匹配的 /api/* 路径统一返回 JSON 404
  app.all('/api/*', (c) => {
    return c.json({ error: '接口不存在' }, 404);
  });

  // 非 API 请求转发至 Cloudflare Static Assets（支持本地开发及兜底静态页面返回）
  app.all('*', async (c) => {
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.text('Not Found', 404);
  });

  // 全局异常兜底处理，避免暴露内部堆栈信息
  app.onError((err, c) => {
    console.error('[Worker Error]', err);
    return c.json({ error: '服务器内部处理异常，请稍后重试' }, 500);
  });

  return app;
}
