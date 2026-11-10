/**
 * ============================================================================
 * 表单字段、金额精度与上传文件安全校验模块
 * 说明：
 * 1. 严格校验 5 个字符串字段（下单时间、订单号、订单金额、下单用户-微信名、不含税金额）；
 * 2. 金额解析采用字符串拆分转整数“分”算法，杜绝 IEEE 754 浮点数精度误差；
 * 3. 上传文件通过读取二进制文件头魔数 (Magic Bytes) 识别真实文件类型，防止后缀/MIME 伪造。
 * ============================================================================
 */

import { FIELD_LABELS, type SubmissionFieldName } from '../types';

/** 单张图片允许的最大字节数：1 MB（前端压缩后通常仅 80KB~250KB） */
export const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024;

/** 发票文件（支持图片或 PDF）允许的最大字节数：1.2 MB（确保在 D1 单行 2MB 上限内安全存储） */
export const MAX_INVOICE_SIZE_BYTES = Math.floor(1.2 * 1024 * 1024);

/** 支持的图片真实 MIME 类型集合 */
export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** 发票字段额外支持的 PDF MIME 类型 */
export const ALLOWED_INVOICE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

/**
 * 经过校验并标准化后的 5 个字符串字段结构
 */
export interface ValidatedSubmissionFields {
  order_time: string;
  order_no: string;
  order_amount: string;
  order_amount_cents: number;
  wechat_name: string;
  amount_excl_tax: string;
  amount_excl_tax_cents: number;
}

/**
 * 经过魔数校验后的单个上传文件数据结构
 */
export interface ValidatedFileData {
  field_name: SubmissionFieldName;
  file_name: string;
  mime_type: string;
  file_size: number;
  bytes: Uint8Array;
}

/**
 * 将金额字符串精确解析为整数“分”（避免浮点数精度丢失）
 * 合法格式示例：`"0"`, `"12"`, `"199.5"`, `"199.99"`, `"0.01"`
 *
 * @param raw 原始金额字符串
 * @returns 整数“分”；若格式非法或超出安全范围则返回 null
 */
export function parseAmountToCents(raw: string): number | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  // 允许 0 或不以多余前导零开头的非负十进制数，最多 2 位小数，最大支持百亿级
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  const [yuanPart, fenPart = ''] = trimmed.split('.');
  const yuan = Number(yuanPart);
  const fenPadded = fenPart.padEnd(2, '0');
  const fen = Number(fenPadded);
  const totalCents = yuan * 100 + fen;

  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return null;
  }
  return totalCents;
}

/**
 * 将整数“分”格式化为保留两位小数的“元”字符串（如 `19900 -> "199.00"`）
 *
 * @param cents 整数“分”
 * @returns 两位小数金额字符串
 */
export function formatCentsToYuan(cents: number): string {
  const safeCents = Math.round(Number(cents) || 0);
  const isNegative = safeCents < 0;
  const absCents = Math.abs(safeCents);
  const yuan = Math.floor(absCents / 100);
  const fen = absCents % 100;
  const formatted = `${yuan}.${String(fen).padStart(2, '0')}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * 校验表单中的 5 个字符串字段
 *
 * @param rawFields 表单字段键值对象
 * @returns `{ ok: true, data }` 或 `{ ok: false, error }`
 */
export function validateSubmissionFields(rawFields: Record<string, unknown>):
  | { ok: true; data: ValidatedSubmissionFields }
  | { ok: false; error: string } {
  const getTrimmed = (key: string): string => {
    const val = rawFields[key];
    return typeof val === 'string' ? val.trim() : '';
  };

  const orderTime = getTrimmed('order_time');
  const orderNo = getTrimmed('order_no');
  const orderAmountRaw = getTrimmed('order_amount');
  const wechatName = getTrimmed('wechat_name');
  const amountExclTaxRaw = getTrimmed('amount_excl_tax');

  // 1. 校验下单时间
  if (!orderTime) {
    return { ok: false, error: '请填写下单时间' };
  }
  if (orderTime.length > 64) {
    return { ok: false, error: '下单时间格式过长（最多 64 个字符）' };
  }
  // 校验日期时间基础格式（支持 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss] 或 YYYY/MM/DD）
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(orderTime)) {
    return { ok: false, error: '下单时间格式不正确，请使用如 2026-11-10 14:30:00 的格式' };
  }

  // 2. 校验订单号
  if (!orderNo) {
    return { ok: false, error: '请填写订单号' };
  }
  if (orderNo.length > 100) {
    return { ok: false, error: '订单号长度不能超过 100 个字符' };
  }
  if (/[\x00-\x1F\x7F]/.test(orderNo)) {
    return { ok: false, error: '订单号包含非法控制字符' };
  }

  // 3. 校验订单金额
  if (!orderAmountRaw) {
    return { ok: false, error: '请填写订单金额' };
  }
  const orderAmountCents = parseAmountToCents(orderAmountRaw);
  if (orderAmountCents === null) {
    return { ok: false, error: '订单金额格式不正确，请输入有效的非负数字（最多两位小数）' };
  }

  // 4. 校验下单用户-微信名
  if (!wechatName) {
    return { ok: false, error: '请填写下单用户-微信名' };
  }
  if (wechatName.length > 100) {
    return { ok: false, error: '下单用户-微信名长度不能超过 100 个字符' };
  }

  // 5. 校验不含税金额
  if (!amountExclTaxRaw) {
    return { ok: false, error: '请填写不含税金额' };
  }
  const amountExclTaxCents = parseAmountToCents(amountExclTaxRaw);
  if (amountExclTaxCents === null) {
    return { ok: false, error: '不含税金额格式不正确，请输入有效的非负数字（最多两位小数）' };
  }

  return {
    ok: true,
    data: {
      order_time: orderTime,
      order_no: orderNo,
      order_amount: formatCentsToYuan(orderAmountCents),
      order_amount_cents: orderAmountCents,
      wechat_name: wechatName,
      amount_excl_tax: formatCentsToYuan(amountExclTaxCents),
      amount_excl_tax_cents: amountExclTaxCents,
    },
  };
}

/**
 * 通过文件二进制头部特征字节（Magic Bytes）识别真实文件类型
 * 防止恶意用户通过修改扩展名或伪造 Content-Type 上传非法文件
 *
 * @param bytes 文件二进制内容
 * @returns 识别出的标准 MIME 类型，未知格式返回 null
 */
export function detectMimeTypeByMagicBytes(
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf' | null {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: "GIF8" (47 49 46 38)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }

  // WebP: "RIFF" (52 49 46 46) + 4 bytes size + "WEBP" (57 45 42 50)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  return null;
}

/**
 * 清理并规范化上传文件名，移除路径分隔符与潜在危险字符
 * @param rawName 原始文件名
 * @param fallbackExt 默认扩展名
 * @returns 安全的文件名
 */
export function sanitizeFileName(rawName: string | undefined, fallbackExt: string): string {
  const base = (rawName ?? '').split(/[/\\]/).pop()?.trim() ?? '';
  const cleaned = base.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `upload_${Date.now()}.${fallbackExt}`;
  }
  return cleaned;
}

/**
 * 校验单个上传的附件字段（订单截图、评价截图、微信收款码或发票文件）
 *
 * @param file FormData 中解析出的 File 对象
 * @param fieldName 附件字段名
 * @returns `{ ok: true, data }` 或 `{ ok: false, error }`
 */
export async function validateUploadedFile(
  file: unknown,
  fieldName: SubmissionFieldName,
): Promise<{ ok: true; data: ValidatedFileData } | { ok: false; error: string }> {
  const label = FIELD_LABELS[fieldName];

  // 判断是否为合法的 File/Blob 实例（兼容 Workers runtime 与测试环境的 File polyfill）
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return { ok: false, error: `请上传${label}` };
  }

  const fileObj = file as File;
  if (!fileObj.size || fileObj.size <= 0) {
    return { ok: false, error: `${label}文件内容为空，请重新选择` };
  }

  const isInvoice = fieldName === 'invoice_file';
  const maxBytes = isInvoice ? MAX_INVOICE_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  const maxLabel = isInvoice ? '1.2MB' : '1MB';

  if (fileObj.size > maxBytes) {
    return {
      ok: false,
      error: `${label}文件大小超过限制（最大允许 ${maxLabel}，当前 ${(fileObj.size / 1024).toFixed(0)}KB）`,
    };
  }

  const buffer = await fileObj.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const detectedMime = detectMimeTypeByMagicBytes(bytes);

  const allowedSet = isInvoice ? ALLOWED_INVOICE_MIMES : ALLOWED_IMAGE_MIMES;
  if (!detectedMime || !allowedSet.has(detectedMime)) {
    const allowedHint = isInvoice ? 'JPG / PNG / WebP / GIF 图片或 PDF 文件' : 'JPG / PNG / WebP / GIF 图片';
    return {
      ok: false,
      error: `${label}文件格式不支持，仅允许上传 ${allowedHint}`,
    };
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  };

  return {
    ok: true,
    data: {
      field_name: fieldName,
      file_name: sanitizeFileName(fileObj.name, extMap[detectedMime] ?? 'bin'),
      mime_type: detectedMime,
      file_size: bytes.byteLength,
      bytes,
    },
  };
}

/**
 * 将 Cloudflare D1 查询返回的 BLOB 数据统一标准化为 Uint8Array
 * 说明：Cloudflare D1 运行时会将 SQLite BLOB 返回为 `number[]`，而本地 SQLite 测试可能返回 `Uint8Array` 或 `ArrayBuffer`
 *
 * @param raw D1 返回的 BLOB 字段值
 * @returns Uint8Array
 */
export function normalizeBlobToUint8Array(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  throw new Error('无法识别的 BLOB 二进制数据类型');
}
