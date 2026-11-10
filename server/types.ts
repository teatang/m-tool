/**
 * ============================================================================
 * Cloudflare Workers 后端类型定义模块
 * 说明：统一定义环境变量绑定 (Env)、数据库模型以及前后端接口数据结构
 * ============================================================================
 */

/**
 * Cloudflare Worker 运行时环境变量与资源绑定接口
 */
export interface Env {
  /** Cloudflare D1 数据库绑定实例 */
  DB: D1Database;
  /** Cloudflare Workers Static Assets 静态资源绑定 */
  ASSETS?: Fetcher;
  /** 后台管理员登录密码（通过 `wrangler secret put ADMIN_PASSWORD` 配置） */
  ADMIN_PASSWORD?: string;
  /** 签名密钥（用于签发图形验证码与管理员会话 Cookie，未配置时基于 ADMIN_PASSWORD 自动派生） */
  AUTH_SECRET?: string;
}

/**
 * 允许上传的 4 个附件字段名称枚举联合类型
 */
export type SubmissionFieldName =
  | 'order_screenshot'   // 订单截图
  | 'review_screenshot'  // 评价截图
  | 'wechat_qr_code'     // 微信收款码
  | 'invoice_file';      // 发票文件（支持图片或 PDF）

/**
 * 附件字段中文名称映射表（用于错误提示与日志展示）
 */
export const FIELD_LABELS: Record<SubmissionFieldName, string> = {
  order_screenshot: '订单截图',
  review_screenshot: '评价截图',
  wechat_qr_code: '微信收款码',
  invoice_file: '发票文件',
};

/**
 * 订单提交记录在数据库中的完整行结构
 */
export interface SubmissionRow {
  id: string;
  order_time: string;
  order_no: string;
  order_amount: string;
  order_amount_cents: number;
  wechat_name: string;
  amount_excl_tax: string;
  amount_excl_tax_cents: number;
  order_screenshot_id: string;
  review_screenshot_id: string;
  wechat_qr_code_id: string;
  invoice_file_id: string;
  created_at: string;
  created_at_ms: number;
}

/**
 * 附件元信息（不包含二进制 BLOB，用于列表与详情页轻量返回）
 */
export interface SubmissionFileMeta {
  id: string;
  field_name: SubmissionFieldName;
  file_name: string;
  mime_type: string;
  file_size: number;
}

/**
 * 返回给后台列表与详情页的订单记录结构（附带 4 个附件的元信息）
 */
export interface SubmissionItem {
  id: string;
  order_time: string;
  order_no: string;
  order_amount: string;
  order_amount_cents: number;
  wechat_name: string;
  amount_excl_tax: string;
  amount_excl_tax_cents: number;
  created_at: string;
  created_at_ms: number;
  files: {
    order_screenshot: SubmissionFileMeta;
    review_screenshot: SubmissionFileMeta;
    wechat_qr_code: SubmissionFileMeta;
    invoice_file: SubmissionFileMeta;
  };
}

/**
 * 后台汇总统计指标结构
 */
export interface SummaryStats {
  /** 符合当前筛选条件的总记录数 */
  total_count: number;
  /** 订单总金额（格式化字符串，单位：元） */
  total_order_amount: string;
  /** 订单总金额（整数分） */
  total_order_amount_cents: number;
  /** 不含税总金额（格式化字符串，单位：元） */
  total_excl_tax_amount: string;
  /** 不含税总金额（整数分） */
  total_excl_tax_amount_cents: number;
  /** 今日新增提交数量（按 UTC+8 北京时间统计） */
  today_count: number;
}

/**
 * 后台分页查询接口响应结构
 */
export interface PaginatedSubmissionsResponse {
  items: SubmissionItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  summary: SummaryStats;
}
