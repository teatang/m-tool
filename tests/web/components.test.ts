/**
 * ============================================================================
 * 前端核心页面与上传组件渲染交互单元测试
 * @vitest-environment happy-dom
 * ============================================================================
 */

import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileUploadCard from '../../src/components/FileUploadCard.vue';
import router from '../../src/router';
import AdminView from '../../src/views/AdminView.vue';
import UploadView from '../../src/views/UploadView.vue';

describe('前端组件与前台单页测试', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FileUploadCard 拒绝在非发票字段上传 PDF，并允许合法 PDF 上传到发票字段', async () => {
    const rejectedWrapper = mount(FileUploadCard, {
      global: { plugins: [ElementPlus] },
      props: {
        modelValue: null,
        label: '微信收款码',
        allowPdf: false,
      },
    });

    const input = rejectedWrapper.find('input[type="file"]');
    const pdfFile = new File(['%PDF-1.7'], 'bad.pdf', { type: 'application/pdf' });
    Object.defineProperty(input.element, 'files', { value: [pdfFile], configurable: true });
    await input.trigger('change');
    expect(rejectedWrapper.emitted('update:modelValue')).toBeUndefined();

    const allowedWrapper = mount(FileUploadCard, {
      global: { plugins: [ElementPlus] },
      props: {
        modelValue: null,
        label: '发票文件',
        allowPdf: true,
      },
    });
    const allowedInput = allowedWrapper.find('input[type="file"]');
    Object.defineProperty(allowedInput.element, 'files', { value: [pdfFile], configurable: true });
    await allowedInput.trigger('change');

    const emitted = allowedWrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(pdfFile);
  });

  it('UploadView 渲染全部 5 个字符串字段、4 个附件上传区、图形验证码及响应“此刻”填充', async () => {
    // Mock fetch 拦截初始化时的 /api/captcha 请求
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          captcha_id: 'cid-1',
          expires_at: Date.now() + 300_000,
          token: 'cid-1.123.sig',
          image_data_url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await router.push('/');
    await router.isReady();

    const wrapper = mount(UploadView, {
      global: { plugins: [ElementPlus, router] },
    });

    // 等待异步 fetchCaptcha 完成
    await new Promise((r) => setTimeout(r, 20));

    const text = wrapper.text();
    // 校验 5 个字符串字段标签
    expect(text).toContain('下单时间');
    expect(text).toContain('订单号');
    expect(text).toContain('订单金额');
    expect(text).toContain('下单用户-微信名');
    expect(text).toContain('不含税金额');

    // 校验 4 个附件字段标签
    expect(text).toContain('订单截图');
    expect(text).toContain('评价截图');
    expect(text).toContain('微信收款码');
    expect(text).toContain('发票文件');

    // 校验图形验证码区域已渲染
    expect(text).toContain('图形验证码');
    const captchaImg = wrapper.find('img[alt="图形验证码"]');
    expect(captchaImg.exists()).toBe(true);

    // 点击“此刻”按钮应自动填充时间格式字符串
    const nowBtn = wrapper.findAll('button').find((b) => b.text().includes('此刻'));
    expect(nowBtn).toBeDefined();
    await nowBtn!.trigger('click');
    const dateInput = wrapper.find('input[placeholder="选择下单日期与时间"]');
    expect((dateInput.element as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('AdminView 未登录展示登录卡片，已登录渲染汇总指标及移动端卡片视图', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/me')) {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await router.push('/admin');
    await router.isReady();

    const unauthWrapper = mount(AdminView, {
      global: { plugins: [ElementPlus, router] },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(unauthWrapper.text()).toContain('订单汇总管理后台');
    expect(unauthWrapper.text()).toContain('登录后台');

    fetchMock.mockRestore();

    // 模拟手机屏幕宽度 (375px) 下已登录状态
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/me')) {
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/admin/submissions')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'sub-999',
                order_time: '2026-11-10 12:00:00',
                order_no: 'ORD-MOBILE-999',
                order_amount: '388.00',
                order_amount_cents: 38800,
                wechat_name: '手机端测试用户',
                amount_excl_tax: '343.36',
                amount_excl_tax_cents: 34336,
                created_at: '2026-11-10T04:00:00.000Z',
                created_at_ms: 1794283200000,
                files: {
                  order_screenshot: { id: 'f1', field_name: 'order_screenshot', file_name: '1.jpg', mime_type: 'image/jpeg', file_size: 1024 },
                  review_screenshot: { id: 'f2', field_name: 'review_screenshot', file_name: '2.jpg', mime_type: 'image/jpeg', file_size: 1024 },
                  wechat_qr_code: { id: 'f3', field_name: 'wechat_qr_code', file_name: '3.jpg', mime_type: 'image/jpeg', file_size: 1024 },
                  invoice_file: { id: 'f4', field_name: 'invoice_file', file_name: '4.pdf', mime_type: 'application/pdf', file_size: 2048 },
                },
              },
            ],
            pagination: { page: 1, page_size: 15, total: 1, total_pages: 1 },
            summary: {
              total_count: 1,
              total_order_amount: '388.00',
              total_order_amount_cents: 38800,
              total_excl_tax_amount: '343.36',
              total_excl_tax_amount_cents: 34336,
              today_count: 1,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const authWrapper = mount(AdminView, {
      global: { plugins: [ElementPlus, router] },
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(authWrapper.text()).toContain('ORD-MOBILE-999');
    expect(authWrapper.text()).toContain('388.00');
    expect(authWrapper.text()).toContain('343.36');
    // 验证手机端启用了卡片视图而非宽表格
    expect(authWrapper.find('.mobile-order-card').exists()).toBe(true);
  });
});
