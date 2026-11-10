/**
 * ============================================================================
 * Workers 后端全链路 API 集成单元测试 (Hono + 内存 SQLite D1)
 * 覆盖流程：
 * - 健康检查、图形验证码获取与校验
 * - 完整表单 + 4 个附件上传、防重放拦截、非法文件拦截
 * - 管理员登录、Cookie 鉴权拦截、分页与搜索过滤、精确金额汇总
 * - 附件二进制流读取与下载、CSV 导出、级联删除记录
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { Env, PaginatedSubmissionsResponse, SubmissionItem } from '../../server/types';
import { createMockD1Database } from '../helpers/mockD1';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

describe('Workers API 全链路集成测试', () => {
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const db = await createMockD1Database();
    env = {
      DB: db,
      ADMIN_PASSWORD: 'super-secret-password',
      AUTH_SECRET: 'unit-test-hmac-secret-key',
    };
    app = createApp();
  });

  /** 辅助方法：请求 /api/captcha 并从 SVG 中解析出验证码文本与 token */
  async function fetchSolvedCaptcha(): Promise<{ token: string; code: string }> {
    const res = await app.request('https://example.com/api/captcha', {}, env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string; image_data_url: string };
    const b64 = data.image_data_url.replace('data:image/svg+xml;base64,', '');
    const svg = Buffer.from(b64, 'base64').toString('utf-8');
    const code = [...svg.matchAll(/>([2-9A-Z])<\/text>/g)].map((m) => m[1]).join('');
    expect(code).toHaveLength(4);
    return { token: data.token, code };
  }

  /** 辅助方法：构造完整的合法上传 FormData */
  function buildValidFormData(
    captcha: { token: string; code: string },
    overrides: Partial<{
      order_time: string;
      order_no: string;
      order_amount: string;
      wechat_name: string;
      amount_excl_tax: string;
    }> = {},
  ): FormData {
    const fd = new FormData();
    fd.append('order_time', overrides.order_time ?? '2026-11-10 14:30:00');
    fd.append('order_no', overrides.order_no ?? 'ORD-20261110-888');
    fd.append('order_amount', overrides.order_amount ?? '199.50');
    fd.append('wechat_name', overrides.wechat_name ?? '微信测试用户');
    fd.append('amount_excl_tax', overrides.amount_excl_tax ?? '176.55');
    fd.append('captcha_token', captcha.token);
    fd.append('captcha_code', captcha.code);
    fd.append('order_screenshot', new File([JPEG_BYTES], 'order.jpg', { type: 'image/jpeg' }));
    fd.append('review_screenshot', new File([PNG_BYTES], 'review.png', { type: 'image/png' }));
    fd.append('wechat_qr_code', new File([WEBP_BYTES], 'qr.webp', { type: 'image/webp' }));
    fd.append('invoice_file', new File([PDF_BYTES], 'invoice.pdf', { type: 'application/pdf' }));
    return fd;
  }

  /** 辅助方法：管理员登录并提取 Cookie 请求头字符串 */
  async function loginAsAdmin(): Promise<string> {
    const loginRes = await app.request(
      'https://example.com/api/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'super-secret-password' }),
      },
      env,
    );
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('Set-Cookie');
    expect(setCookie).toContain('admin_session=');
    return setCookie!.split(';')[0];
  }

  it('健康检查接口正常返回数据库连接成功', async () => {
    const res = await app.request('https://example.com/api/health', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; database: string };
    expect(json).toEqual({ status: 'ok', database: 'connected' });
  });

  it('拦截错误验证码、非法附件、并防止同一验证码被重放提交', async () => {
    const captcha = await fetchSolvedCaptcha();

    // 1. 验证码错误
    const badCaptchaFd = buildValidFormData({ token: captcha.token, code: '0000' });
    const resBadCap = await app.request(
      'https://example.com/api/submissions',
      { method: 'POST', body: badCaptchaFd },
      env,
    );
    expect(resBadCap.status).toBe(400);

    // 2. 伪造图片头部字节应被拦截
    const spoofedFd = buildValidFormData(captcha);
    spoofedFd.set(
      'order_screenshot',
      new File(['not-an-image'], 'fake.png', { type: 'image/png' }),
    );
    const resSpoofed = await app.request(
      'https://example.com/api/submissions',
      { method: 'POST', body: spoofedFd },
      env,
    );
    expect(resSpoofed.status).toBe(400);

    // 3. 首次合法提交成功
    const okFd = buildValidFormData(captcha);
    const resOk = await app.request(
      'https://example.com/api/submissions',
      { method: 'POST', body: okFd },
      env,
    );
    expect(resOk.status).toBe(201);

    // 4. 重复使用同一份已通过的 captcha 进行二次提交必须被防重放机制拦截
    const replayFd = buildValidFormData(captcha, { order_no: 'ORD-REPLAY' });
    const resReplay = await app.request(
      'https://example.com/api/submissions',
      { method: 'POST', body: replayFd },
      env,
    );
    expect(resReplay.status).toBe(400);
    const replayJson = (await resReplay.json()) as { code?: string };
    expect(replayJson.code).toBe('CAPTCHA_REUSED');
  });

  it('未授权访问后台接口返回 401，错误密码登录失败', async () => {
    const unauthRes = await app.request('https://example.com/api/admin/submissions', {}, env);
    expect(unauthRes.status).toBe(401);

    const badLoginRes = await app.request(
      'https://example.com/api/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password' }),
      },
      env,
    );
    expect(badLoginRes.status).toBe(401);
  });

  it('完整闭环：上传多条订单 -> 管理员查询/搜索/统计 -> 预览附件 -> 导出 CSV -> 删除记录', async () => {
    // 上传两笔不同金额和微信名的订单
    const cap1 = await fetchSolvedCaptcha();
    const res1 = await app.request(
      'https://example.com/api/submissions',
      {
        method: 'POST',
        body: buildValidFormData(cap1, {
          order_time: '2026-11-09 10:00:00',
          order_no: 'ORD-1001',
          order_amount: '100.10',
          wechat_name: 'Alice_VIP',
          amount_excl_tax: '88.58',
        }),
      },
      env,
    );
    expect(res1.status).toBe(201);
    const created1 = (await res1.json()) as { id: string };

    const cap2 = await fetchSolvedCaptcha();
    const res2 = await app.request(
      'https://example.com/api/submissions',
      {
        method: 'POST',
        body: buildValidFormData(cap2, {
          order_time: '2026-11-10 15:20:00',
          order_no: 'ORD-1002',
          order_amount: '200.20',
          wechat_name: 'Bob_100%',
          amount_excl_tax: '177.17',
        }),
      },
      env,
    );
    expect(res2.status).toBe(201);

    // 管理员登录
    const cookie = await loginAsAdmin();

    // 查询全部列表与汇总金额（100.10 + 200.20 = 300.30；88.58 + 177.17 = 265.75）
    const listRes = await app.request(
      'https://example.com/api/admin/submissions',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as PaginatedSubmissionsResponse;
    expect(listData.items).toHaveLength(2);
    expect(listData.summary.total_count).toBe(2);
    expect(listData.summary.total_order_amount).toBe('300.30');
    expect(listData.summary.total_excl_tax_amount).toBe('265.75');
    expect(listData.summary.today_count).toBe(2);

    // 关键词精准搜索（含 `%` 通配符字符测试）
    const searchRes = await app.request(
      'https://example.com/api/admin/submissions?keyword=' + encodeURIComponent('100%'),
      { headers: { Cookie: cookie } },
      env,
    );
    const searchData = (await searchRes.json()) as PaginatedSubmissionsResponse;
    expect(searchData.items).toHaveLength(1);
    expect(searchData.items[0].order_no).toBe('ORD-1002');
    expect(searchData.summary.total_order_amount).toBe('200.20');

    // 日期范围过滤
    const dateFilterRes = await app.request(
      'https://example.com/api/admin/submissions?start_date=2026-11-10&end_date=2026-11-10',
      { headers: { Cookie: cookie } },
      env,
    );
    const dateFilterData = (await dateFilterRes.json()) as PaginatedSubmissionsResponse;
    expect(dateFilterData.items).toHaveLength(1);
    expect(dateFilterData.items[0].order_no).toBe('ORD-1002');

    // 查询单条详情并拉取 PDF 发票文件二进制流
    const detailRes = await app.request(
      `https://example.com/api/admin/submissions/${created1.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as { item: SubmissionItem };
    const invoiceFileId = detailData.item.files.invoice_file.id;

    const fileRes = await app.request(
      `https://example.com/api/admin/files/${invoiceFileId}?download=1`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('Content-Type')).toBe('application/pdf');
    expect(fileRes.headers.get('Content-Disposition')).toContain('attachment');
    const fetchedBytes = new Uint8Array(await fileRes.arrayBuffer());
    expect(Array.from(fetchedBytes)).toEqual(Array.from(PDF_BYTES));

    // 导出 CSV 验证内容
    const exportRes = await app.request(
      'https://example.com/api/admin/submissions/export',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(exportRes.status).toBe(200);
    const csvText = await exportRes.text();
    expect(csvText).toContain('ORD-1001');
    expect(csvText).toContain('ORD-1002');

    // 删除记录 1，确认主表及附件表均被清理
    const delRes = await app.request(
      `https://example.com/api/admin/submissions/${created1.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(delRes.status).toBe(200);

    const deletedFileRes = await app.request(
      `https://example.com/api/admin/files/${invoiceFileId}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(deletedFileRes.status).toBe(404);
  });
});
