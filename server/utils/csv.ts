/**
 * ============================================================================
 * 后台汇总数据 CSV 导出工具模块
 * 说明：
 * 1. 自动在文件头部添加 UTF-8 BOM (`\uFEFF`)，确保 Windows / macOS Excel 双击打开不乱码；
 * 2. 内置 CSV 公式注入防护（防止以 `=`、`+`、`-`、`@` 开头的微信名或订单号在 Excel 中触发公式执行）。
 * ============================================================================
 */

import type { SubmissionItem } from '../types';

/**
 * 对单个 CSV 单元格内容进行安全转义与公式注入防护
 * @param value 原始字符串
 * @returns 转义后的安全 CSV 字段
 */
export function escapeCsvCell(value: string): string {
  const str = String(value ?? '');
  // 若以潜在公式字符开头（且不是纯数字金额），在前面加单引号防止 Excel 公式注入
  const isFormulaTrigger = /^[=+\-@\t\r]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str);
  const safeStr = isFormulaTrigger ? `'${str}` : str;

  if (/[",\r\n]/.test(safeStr)) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }
  return safeStr;
}

/**
 * 将订单汇总列表序列化为带 UTF-8 BOM 的 CSV 字符串
 * @param items 订单列表
 * @returns CSV 文本内容
 */
export function buildSubmissionsCsv(items: SubmissionItem[]): string {
  const headers = [
    '记录ID',
    '下单时间',
    '订单号',
    '订单金额(元)',
    '下单用户-微信名',
    '不含税金额(元)',
    '提交时间(UTC)',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const item of items) {
    const row = [
      item.id,
      item.order_time,
      item.order_no,
      item.order_amount,
      item.wechat_name,
      item.amount_excl_tax,
      item.created_at,
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}
