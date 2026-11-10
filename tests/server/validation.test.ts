/**
 * ============================================================================
 * 表单字段、金额精度与文件魔数校验单元测试 (server/utils/validation.ts)
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  detectMimeTypeByMagicBytes,
  formatCentsToYuan,
  MAX_IMAGE_SIZE_BYTES,
  normalizeBlobToUint8Array,
  parseAmountToCents,
  validateSubmissionFields,
  validateUploadedFile,
} from '../../server/utils/validation';

/** 构造带指定文件头魔数的模拟 File 对象 */
function makeMockFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const GIF_BYTES = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00];
const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

describe('server/utils/validation', () => {
  it('parseAmountToCents 与 formatCentsToYuan 无浮点误差转换金额', () => {
    expect(parseAmountToCents('0')).toBe(0);
    expect(parseAmountToCents('0.01')).toBe(1);
    expect(parseAmountToCents('199.5')).toBe(19950);
    expect(parseAmountToCents('19.99')).toBe(1999);
    // 验证经典 IEEE 754 浮点坑：0.1 + 0.2 与 19.99 * 100
    expect(parseAmountToCents('0.1')! + parseAmountToCents('0.2')!).toBe(30);
    expect(formatCentsToYuan(30)).toBe('0.30');
    expect(formatCentsToYuan(1999)).toBe('19.99');

    // 非法输入拦截
    expect(parseAmountToCents('-10')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
    expect(parseAmountToCents('012.00')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
  });

  it('validateSubmissionFields 校验并规范化 5 个字符串字段', () => {
    const ok = validateSubmissionFields({
      order_time: ' 2026-11-10 14:30:00 ',
      order_no: ' ORD-20261110-001 ',
      order_amount: ' 299.5 ',
      wechat_name: ' 小茶同学 ',
      amount_excl_tax: ' 265.04 ',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.order_time).toBe('2026-11-10 14:30:00');
      expect(ok.data.order_no).toBe('ORD-20261110-001');
      expect(ok.data.order_amount).toBe('299.50');
      expect(ok.data.order_amount_cents).toBe(29950);
      expect(ok.data.wechat_name).toBe('小茶同学');
      expect(ok.data.amount_excl_tax).toBe('265.04');
      expect(ok.data.amount_excl_tax_cents).toBe(26504);
    }

    // 缺少微信号
    const noWechat = validateSubmissionFields({
      order_time: '2026-11-10 14:30:00',
      order_no: 'ORD-1',
      order_amount: '100',
      wechat_name: '   ',
      amount_excl_tax: '88',
    });
    expect(noWechat.ok).toBe(false);

    // 下单时间格式非法
    const badTime = validateSubmissionFields({
      order_time: '昨天下午',
      order_no: 'ORD-1',
      order_amount: '100',
      wechat_name: '张三',
      amount_excl_tax: '88',
    });
    expect(badTime.ok).toBe(false);
  });

  it('detectMimeTypeByMagicBytes 精准识别真实文件类型并拒绝伪装文件', () => {
    expect(detectMimeTypeByMagicBytes(new Uint8Array(JPEG_BYTES))).toBe('image/jpeg');
    expect(detectMimeTypeByMagicBytes(new Uint8Array(PNG_BYTES))).toBe('image/png');
    expect(detectMimeTypeByMagicBytes(new Uint8Array(WEBP_BYTES))).toBe('image/webp');
    expect(detectMimeTypeByMagicBytes(new Uint8Array(GIF_BYTES))).toBe('image/gif');
    expect(detectMimeTypeByMagicBytes(new Uint8Array(PDF_BYTES))).toBe('application/pdf');

    // 文本伪装成图片应识别失败
    const fakePng = new TextEncoder().encode('<script>alert(1)</script>');
    expect(detectMimeTypeByMagicBytes(fakePng)).toBeNull();
  });

  it('validateUploadedFile 校验允许的文件类型、大小上限与伪造 MIME', async () => {
    // 1. 合法 PNG 上传到订单截图
    const pngFile = makeMockFile(PNG_BYTES, 'order.png', 'image/png');
    const res1 = await validateUploadedFile(pngFile, 'order_screenshot');
    expect(res1.ok).toBe(true);

    // 2. 合法 PDF 上传到发票字段应当允许
    const pdfFile = makeMockFile(PDF_BYTES, 'invoice.pdf', 'application/pdf');
    const res2 = await validateUploadedFile(pdfFile, 'invoice_file');
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.data.mime_type).toBe('application/pdf');
    }

    // 3. PDF 传给非发票截图字段应当拦截
    const res3 = await validateUploadedFile(pdfFile, 'wechat_qr_code');
    expect(res3.ok).toBe(false);

    // 4. 伪造 image/png MIME 的文本文件应被魔数校验拦截
    const fakeFile = new File(['hello hacker'], 'hack.png', { type: 'image/png' });
    const res4 = await validateUploadedFile(fakeFile, 'review_screenshot');
    expect(res4.ok).toBe(false);

    // 5. 超大图片应被大小限制拦截
    const hugeBytes = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 100);
    hugeBytes.set(JPEG_BYTES, 0);
    const hugeFile = new File([hugeBytes], 'big.jpg', { type: 'image/jpeg' });
    const res5 = await validateUploadedFile(hugeFile, 'order_screenshot');
    expect(res5.ok).toBe(false);
  });

  it('normalizeBlobToUint8Array 兼容 D1 number[]、Uint8Array 与 ArrayBuffer', () => {
    const arr = normalizeBlobToUint8Array([1, 2, 255]);
    expect(Array.from(arr)).toEqual([1, 2, 255]);

    const u8 = normalizeBlobToUint8Array(new Uint8Array([10, 20]));
    expect(Array.from(u8)).toEqual([10, 20]);

    const buf = normalizeBlobToUint8Array(new Uint8Array([5, 6]).buffer);
    expect(Array.from(buf)).toEqual([5, 6]);
  });
});
