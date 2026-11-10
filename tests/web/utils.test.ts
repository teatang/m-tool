/**
 * ============================================================================
 * 前端格式化与图片压缩纯函数单元测试 (src/utils/*)
 * @vitest-environment happy-dom
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  formatCurrencyDisplay,
  formatFileSize,
  formatIsoToBeijingTime,
  isValidAmountInput,
  normalizeAmountOnBlur,
} from '../../src/utils/format';
import { calculateTargetDimensions, compressImageFile } from '../../src/utils/imageCompress';

describe('src/utils/format', () => {
  it('formatFileSize 正确格式化 B / KB / MB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 * 1.25)).toBe('1.25 MB');
  });

  it('formatIsoToBeijingTime 准确将 UTC ISO 时间转换为北京时间', () => {
    expect(formatIsoToBeijingTime('2026-11-10T06:30:15.000Z')).toBe('2026-11-10 14:30:15');
    expect(formatIsoToBeijingTime('')).toBe('-');
  });

  it('isValidAmountInput 与 normalizeAmountOnBlur 校验并补齐两位小数', () => {
    expect(isValidAmountInput('199')).toBe(true);
    expect(isValidAmountInput('199.5')).toBe(true);
    expect(isValidAmountInput('0.01')).toBe(true);
    expect(isValidAmountInput('-10')).toBe(false);
    expect(isValidAmountInput('12.345')).toBe(false);

    expect(normalizeAmountOnBlur('199')).toBe('199.00');
    expect(normalizeAmountOnBlur('19.5')).toBe('19.50');
    expect(normalizeAmountOnBlur('abc')).toBe('abc');
  });

  it('formatCurrencyDisplay 添加千分位分隔符', () => {
    expect(formatCurrencyDisplay('1234567.89')).toBe('1,234,567.89');
    expect(formatCurrencyDisplay('99.5')).toBe('99.50');
  });
});

describe('src/utils/imageCompress', () => {
  it('calculateTargetDimensions 仅在超过最大边长时按比例缩小，从不放大原图', () => {
    expect(calculateTargetDimensions(800, 600, 1400)).toEqual({ width: 800, height: 600 });
    expect(calculateTargetDimensions(2800, 1400, 1400)).toEqual({ width: 1400, height: 700 });
    expect(calculateTargetDimensions(1500, 3000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('compressImageFile 对 PDF 和 GIF 文件保持原样不破坏格式', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'invoice.pdf', {
      type: 'application/pdf',
    });
    const pdfRes = await compressImageFile(pdf);
    expect(pdfRes.wasCompressed).toBe(false);
    expect(pdfRes.file).toBe(pdf);

    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], 'anim.gif', {
      type: 'image/gif',
    });
    const gifRes = await compressImageFile(gif);
    expect(gifRes.wasCompressed).toBe(false);
    expect(gifRes.file).toBe(gif);
  });
});
