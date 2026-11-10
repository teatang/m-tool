/**
 * ============================================================================
 * 前端通用格式化与表单输入校验工具模块
 * ============================================================================
 */

/**
 * 将字节数格式化为人类易读的文件大小字符串（例如 `186 KB`、`1.12 MB`）
 * @param bytes 文件字节数
 * @returns 格式化后的文件大小文本
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 将 UTC ISO 时间字符串格式化为北京时间（UTC+8）`YYYY-MM-DD HH:mm:ss`
 * 说明：手动加 8 小时偏移量并使用 UTC Getter，保证任意地区或测试环境输出一致
 *
 * @param iso ISO-8601 时间字符串
 * @returns 北京时间格式字符串；无效输入返回原字符串
 */
export function formatIsoToBeijingTime(iso: string): string {
  if (!iso) {
    return '-';
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return iso;
  }
  const bj = new Date(ts + 8 * 60 * 60 * 1000);
  const year = bj.getUTCFullYear();
  const month = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bj.getUTCDate()).padStart(2, '0');
  const hours = String(bj.getUTCHours()).padStart(2, '0');
  const minutes = String(bj.getUTCMinutes()).padStart(2, '0');
  const seconds = String(bj.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前本地/北京时间的 `YYYY-MM-DD HH:mm:ss` 字符串（用于快捷填入“此刻”）
 * @param nowMs 可选时间戳（默认当前时间）
 */
export function getCurrentDateTimeString(nowMs: number = Date.now()): string {
  return formatIsoToBeijingTime(new Date(nowMs).toISOString());
}

/**
 * 校验金额输入字符串是否为合法的非负十进制金额（最多两位小数）
 * @param raw 输入字符串
 */
export function isValidAmountInput(raw: string): boolean {
  if (typeof raw !== 'string') {
    return false;
  }
  const trimmed = raw.trim();
  return /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(trimmed);
}

/**
 * 金额输入框失焦时自动规范化为两位小数字符串（如 `"199"` -> `"199.00"`，`"19.5"` -> `"19.50"`）
 * 若输入内容非法则原样保留 trimmed 字符串，交由表单规则提示错误
 *
 * @param raw 原始输入
 * @returns 规范化后的字符串
 */
export function normalizeAmountOnBlur(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !isValidAmountInput(trimmed)) {
    return trimmed;
  }
  const [yuan, fen = ''] = trimmed.split('.');
  return `${yuan}.${fen.padEnd(2, '0')}`;
}

/**
 * 将金额文本格式化为千分位显示（如 `"12345.67"` -> `"12,345.67"`）
 * @param amountStr 金额字符串
 */
export function formatCurrencyDisplay(amountStr: string): string {
  const trimmed = (amountStr ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed || '0.00';
  }
  const [intPart, decPart = '00'] = trimmed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${formattedInt}.${decPart.padEnd(2, '0')}`;
}
