/**
 * ============================================================================
 * 后台管理与汇总查阅 API 路由模块
 * 路由列表：
 * - POST   /api/admin/login               管理员登录签发 HttpOnly Cookie
 * - POST   /api/admin/logout              退出登录清除 Cookie
 * - GET    /api/admin/me                  检查当前会话登录状态
 * - GET    /api/admin/submissions         分页查询订单列表 + 汇总金额统计
 * - GET    /api/admin/submissions/export  导出当前筛选结果为 UTF-8 CSV
 * - GET    /api/admin/submissions/:id     查看单条订单完整详情
 * - DELETE /api/admin/submissions/:id     删除单条订单及其关联附件
 * - GET    /api/admin/files/:id           预览或下载单个附件二进制文件
 * ============================================================================
 */

import { Hono } from 'hono';
import {
  buildLogoutCookieHeader,
  buildSessionCookieHeader,
  extractAdminToken,
  isHttpsRequest,
  requireAdminAuth,
} from '../middleware/auth';
import type {
  Env,
  SubmissionFieldName,
  SubmissionFileMeta,
  SubmissionItem,
  SubmissionRow,
  SummaryStats,
} from '../types';
import {
  createAdminSessionToken,
  resolveSigningSecret,
  timingSafeEqualStrings,
  verifyAdminSessionToken,
} from '../utils/crypto';
import { buildSubmissionsCsv } from '../utils/csv';
import { formatCentsToYuan, normalizeBlobToUint8Array } from '../utils/validation';

export const adminRoutes = new Hono<{ Bindings: Env }>();

/**
 * 计算东八区（北京时间 UTC+8）当天 00:00:00 对应的 UTC 毫秒时间戳
 * 说明：不依赖运行环境本地时区，在 Cloudflare Workers 全球边缘节点均可得出一致的北京时间当日起点
 *
 * @param nowMs 当前 UTC 毫秒时间戳
 * @returns 北京时间当日零点的毫秒时间戳
 */
export function getBeijingDayStartMs(nowMs: number = Date.now()): number {
  const offsetMs = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(nowMs + offsetMs);
  const year = beijingTime.getUTCFullYear();
  const month = beijingTime.getUTCMonth();
  const day = beijingTime.getUTCDate();
  return Date.UTC(year, month, day, 0, 0, 0, 0) - offsetMs;
}

/**
 * 转义 SQLite LIKE 通配符 (`%`、`_`、`\`)，防止用户输入通配符干扰精确模糊搜索
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * 根据查询参数构建可复用的参数化 WHERE 条件子句
 */
export function buildSubmissionsWhereClause(params: {
  keyword?: string;
  startDate?: string;
  endDate?: string;
}): { whereSql: string; bindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  const keyword = params.keyword?.trim();
  if (keyword) {
    const escaped = `%${escapeLikePattern(keyword)}%`;
    const idx1 = bindings.length + 1;
    const idx2 = bindings.length + 2;
    conditions.push(`(order_no LIKE ?${idx1} ESCAPE '\\' OR wechat_name LIKE ?${idx2} ESCAPE '\\')`);
    bindings.push(escaped, escaped);
  }

  const startDate = params.startDate?.trim();
  if (startDate) {
    const idx = bindings.length + 1;
    conditions.push(`order_time >= ?${idx}`);
    bindings.push(startDate);
  }

  const endDate = params.endDate?.trim();
  if (endDate) {
    const idx = bindings.length + 1;
    // 若传入纯日期 YYYY-MM-DD，自动补齐当天最晚时刻以包含当日全部订单
    const normalizedEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? `${endDate} 23:59:59` : endDate;
    conditions.push(`order_time <= ?${idx}`);
    bindings.push(normalizedEnd);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, bindings };
}

/**
 * 将数据库行与附件元信息列表组装为前端所需的结构化 SubmissionItem 列表
 */
async function attachFilesMetaToSubmissions(
  db: D1Database,
  rows: SubmissionRow[],
): Promise<SubmissionItem[]> {
  if (rows.length === 0) {
    return [];
  }

  const submissionIds = rows.map((r) => r.id);
  const placeholders = submissionIds.map((_, idx) => `?${idx + 1}`).join(', ');
  const filesResult = await db
    .prepare(
      `SELECT id, submission_id, field_name, file_name, mime_type, file_size
       FROM submission_files
       WHERE submission_id IN (${placeholders})`,
    )
    .bind(...submissionIds)
    .all<SubmissionFileMeta & { submission_id: string }>();

  const filesById = new Map<string, SubmissionFileMeta>();
  for (const fileRow of filesResult.results ?? []) {
    filesById.set(fileRow.id, {
      id: fileRow.id,
      field_name: fileRow.field_name as SubmissionFieldName,
      file_name: fileRow.file_name,
      mime_type: fileRow.mime_type,
      file_size: fileRow.file_size,
    });
  }

  const fallbackMeta = (id: string, field_name: SubmissionFieldName): SubmissionFileMeta => ({
    id,
    field_name,
    file_name: 'file',
    mime_type: 'application/octet-stream',
    file_size: 0,
  });

  return rows.map((row) => ({
    id: row.id,
    order_time: row.order_time,
    order_no: row.order_no,
    order_amount: row.order_amount,
    order_amount_cents: row.order_amount_cents,
    wechat_name: row.wechat_name,
    amount_excl_tax: row.amount_excl_tax,
    amount_excl_tax_cents: row.amount_excl_tax_cents,
    created_at: row.created_at,
    created_at_ms: row.created_at_ms,
    files: {
      order_screenshot:
        filesById.get(row.order_screenshot_id) ??
        fallbackMeta(row.order_screenshot_id, 'order_screenshot'),
      review_screenshot:
        filesById.get(row.review_screenshot_id) ??
        fallbackMeta(row.review_screenshot_id, 'review_screenshot'),
      wechat_qr_code:
        filesById.get(row.wechat_qr_code_id) ??
        fallbackMeta(row.wechat_qr_code_id, 'wechat_qr_code'),
      invoice_file:
        filesById.get(row.invoice_file_id) ?? fallbackMeta(row.invoice_file_id, 'invoice_file'),
    },
  }));
}

/**
 * 管理员登录接口
 */
adminRoutes.post('/login', async (c) => {
  const configuredPassword = c.env.ADMIN_PASSWORD?.trim();
  if (!configuredPassword) {
    return c.json(
      { error: '服务端未配置 ADMIN_PASSWORD 环境变量，请先配置管理员密码' },
      500,
    );
  }

  let payload: { password?: unknown };
  try {
    payload = await c.req.json<{ password?: unknown }>();
  } catch {
    return c.json({ error: '请求体必须为合法的 JSON 格式' }, 400);
  }

  const inputPassword = typeof payload.password === 'string' ? payload.password : '';
  if (!inputPassword) {
    return c.json({ error: '请输入管理员密码' }, 400);
  }

  if (!timingSafeEqualStrings(inputPassword, configuredPassword)) {
    return c.json({ error: '管理员密码错误' }, 401);
  }

  const secret = await resolveSigningSecret(c.env);
  const token = await createAdminSessionToken(secret);
  const isHttps = isHttpsRequest(c.req.url, c.req.raw.headers);

  c.header('Set-Cookie', buildSessionCookieHeader(token, isHttps));
  return c.json({ authenticated: true });
});

/**
 * 管理员退出登录接口
 */
adminRoutes.post('/logout', (c) => {
  const isHttps = isHttpsRequest(c.req.url, c.req.raw.headers);
  c.header('Set-Cookie', buildLogoutCookieHeader(isHttps));
  return c.json({ authenticated: false });
});

/**
 * 检查当前管理会话是否已登录
 */
adminRoutes.get('/me', async (c) => {
  const token = extractAdminToken(c.req.raw.headers);
  if (!token) {
    return c.json({ authenticated: false });
  }
  try {
    const secret = await resolveSigningSecret(c.env);
    const valid = await verifyAdminSessionToken(secret, token);
    return c.json({ authenticated: valid });
  } catch {
    return c.json({ authenticated: false });
  }
});

// 以下后台数据与文件接口均需通过管理员鉴权中间件
adminRoutes.use('/submissions/*', requireAdminAuth);
adminRoutes.use('/submissions', requireAdminAuth);
adminRoutes.use('/files/*', requireAdminAuth);

/**
 * 后台分页查询订单列表，同时返回当前筛选条件下的汇总统计信息
 */
adminRoutes.get('/submissions', async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const startDate = c.req.query('start_date') ?? '';
  const endDate = c.req.query('end_date') ?? '';

  const rawPage = Number(c.req.query('page') ?? '1');
  const rawPageSize = Number(c.req.query('page_size') ?? '15');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(100, Math.floor(rawPageSize)) : 15;
  const offset = (page - 1) * pageSize;

  const { whereSql, bindings } = buildSubmissionsWhereClause({
    keyword,
    startDate,
    endDate,
  });

  // 1. 聚合查询符合筛选条件的总数与订单/不含税总金额
  const aggregateRow = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_count,
       COALESCE(SUM(order_amount_cents), 0) AS total_order_amount_cents,
       COALESCE(SUM(amount_excl_tax_cents), 0) AS total_excl_tax_cents
     FROM submissions ${whereSql}`,
  )
    .bind(...bindings)
    .first<{
      total_count: number;
      total_order_amount_cents: number;
      total_excl_tax_cents: number;
    }>();

  // 2. 查询北京时间今日新增提交数（不受筛选日期干扰，反映今日实时工作量）
  const todayStartMs = getBeijingDayStartMs();
  const todayRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS today_count FROM submissions WHERE created_at_ms >= ?1',
  )
    .bind(todayStartMs)
    .first<{ today_count: number }>();

  // 3. 分页查询主表记录
  const limitPlaceholder = `?${bindings.length + 1}`;
  const offsetPlaceholder = `?${bindings.length + 2}`;
  const listResult = await c.env.DB.prepare(
    `SELECT * FROM submissions ${whereSql}
     ORDER BY created_at_ms DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
  )
    .bind(...bindings, pageSize, offset)
    .all<SubmissionRow>();

  const rows = listResult.results ?? [];
  const items = await attachFilesMetaToSubmissions(c.env.DB, rows);

  const totalCount = Number(aggregateRow?.total_count ?? 0);
  const totalOrderCents = Number(aggregateRow?.total_order_amount_cents ?? 0);
  const totalExclTaxCents = Number(aggregateRow?.total_excl_tax_cents ?? 0);
  const todayCount = Number(todayRow?.today_count ?? 0);

  const summary: SummaryStats = {
    total_count: totalCount,
    total_order_amount: formatCentsToYuan(totalOrderCents),
    total_order_amount_cents: totalOrderCents,
    total_excl_tax_amount: formatCentsToYuan(totalExclTaxCents),
    total_excl_tax_amount_cents: totalExclTaxCents,
    today_count: todayCount,
  };

  return c.json({
    items,
    pagination: {
      page,
      page_size: pageSize,
      total: totalCount,
      total_pages: Math.max(1, Math.ceil(totalCount / pageSize)),
    },
    summary,
  });
});

/**
 * 导出当前筛选条件下的订单汇总 CSV 文件（最多导出 5000 条）
 */
adminRoutes.get('/submissions/export', async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const startDate = c.req.query('start_date') ?? '';
  const endDate = c.req.query('end_date') ?? '';

  const { whereSql, bindings } = buildSubmissionsWhereClause({
    keyword,
    startDate,
    endDate,
  });

  const listResult = await c.env.DB.prepare(
    `SELECT * FROM submissions ${whereSql} ORDER BY created_at_ms DESC LIMIT 5000`,
  )
    .bind(...bindings)
    .all<SubmissionRow>();

  const rows = listResult.results ?? [];
  const items = await attachFilesMetaToSubmissions(c.env.DB, rows);
  const csvContent = buildSubmissionsCsv(items);
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-summary-${dateStamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

/**
 * 查询单条订单记录详情
 */
adminRoutes.get('/submissions/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM submissions WHERE id = ?1')
    .bind(id)
    .first<SubmissionRow>();

  if (!row) {
    return c.json({ error: '未找到对应的订单记录' }, 404);
  }

  const [item] = await attachFilesMetaToSubmissions(c.env.DB, [row]);
  return c.json({ item });
});

/**
 * 删除单条订单记录及其关联的 4 个二进制附件
 */
adminRoutes.delete('/submissions/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM submissions WHERE id = ?1')
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: '记录不存在或已被删除' }, 404);
  }

  // 显式通过 batch 先删附件再删主表，确保即便 SQLite 外键开关未启用也不会产生孤儿二进制文件
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM submission_files WHERE submission_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM submissions WHERE id = ?1').bind(id),
  ]);

  return c.json({ deleted: true, id });
});

/**
 * 获取或下载单个附件二进制流（支持图片预览与发票 PDF 预览/下载）
 */
adminRoutes.get('/files/:id', async (c) => {
  const fileId = c.req.param('id');
  const forceDownload = c.req.query('download') === '1';

  const fileRow = await c.env.DB.prepare(
    'SELECT id, file_name, mime_type, file_size, data FROM submission_files WHERE id = ?1',
  )
    .bind(fileId)
    .first<{
      id: string;
      file_name: string;
      mime_type: string;
      file_size: number;
      data: unknown;
    }>();

  if (!fileRow) {
    return c.json({ error: '附件文件不存在' }, 404);
  }

  const bytes = normalizeBlobToUint8Array(fileRow.data);
  const dispositionType = forceDownload ? 'attachment' : 'inline';
  const encodedFileName = encodeURIComponent(fileRow.file_name);

  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: {
      'Content-Type': fileRow.mime_type,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `${dispositionType}; filename*=UTF-8''${encodedFileName}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
