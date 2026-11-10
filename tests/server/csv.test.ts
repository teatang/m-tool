/**
 * ============================================================================
 * CSV 导出与公式注入防护单元测试 (server/utils/csv.ts)
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { SubmissionItem } from '../../server/types';
import { buildSubmissionsCsv, escapeCsvCell } from '../../server/utils/csv';

describe('server/utils/csv', () => {
  it('escapeCsvCell 正确转义逗号/引号并拦截 Excel 公式注入', () => {
    expect(escapeCsvCell('普通微信名')).toBe('普通微信名');
    expect(escapeCsvCell('张,三')).toBe('"张,三"');
    expect(escapeCsvCell('含"引号"文本')).toBe('"含""引号""文本"');
    // 公式注入前缀会被加单引号中和
    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('@evil')).toBe("'@evil");
  });

  it('buildSubmissionsCsv 生成带 UTF-8 BOM 的标准 CSV 内容', () => {
    const items: SubmissionItem[] = [
      {
        id: 'sub-1',
        order_time: '2026-11-10 10:00:00',
        order_no: 'ORD2026001',
        order_amount: '199.00',
        order_amount_cents: 19900,
        wechat_name: '测试用户',
        amount_excl_tax: '176.11',
        amount_excl_tax_cents: 17611,
        created_at: '2026-11-10T02:05:00.000Z',
        created_at_ms: 1794276300000,
        files: {
          order_screenshot: {
            id: 'f1',
            field_name: 'order_screenshot',
            file_name: '1.png',
            mime_type: 'image/png',
            file_size: 100,
          },
          review_screenshot: {
            id: 'f2',
            field_name: 'review_screenshot',
            file_name: '2.png',
            mime_type: 'image/png',
            file_size: 100,
          },
          wechat_qr_code: {
            id: 'f3',
            field_name: 'wechat_qr_code',
            file_name: '3.png',
            mime_type: 'image/png',
            file_size: 100,
          },
          invoice_file: {
            id: 'f4',
            field_name: 'invoice_file',
            file_name: '4.pdf',
            mime_type: 'application/pdf',
            file_size: 200,
          },
        },
      },
    ];

    const csv = buildSubmissionsCsv(items);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('记录ID,下单时间,订单号,订单金额(元),下单用户-微信名,不含税金额(元),提交时间(UTC)');
    expect(csv).toContain('sub-1,2026-11-10 10:00:00,ORD2026001,199.00,测试用户,176.11');
  });
});
