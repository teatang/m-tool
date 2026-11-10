/**
 * ============================================================================
 * 前端 API 数据模型与类型定义模块
 * ============================================================================
 */

/** 附件字段键名联合类型 */
export type SubmissionFieldName =
  | 'order_screenshot'
  | 'review_screenshot'
  | 'wechat_qr_code'
  | 'invoice_file';

/** 图形验证码响应体 */
export interface CaptchaResponse {
  captcha_id: string;
  expires_at: number;
  token: string;
  image_data_url: string;
}

/** 前台提交成功响应体 */
export interface SubmitSuccessResponse {
  id: string;
  order_no: string;
  created_at: string;
  message: string;
}

/** 单个附件元信息 */
export interface SubmissionFileMeta {
  id: string;
  field_name: SubmissionFieldName;
  file_name: string;
  mime_type: string;
  file_size: number;
}

/** 后台单条订单记录结构 */
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

/** 后台汇总统计指标 */
export interface SummaryStats {
  total_count: number;
  total_order_amount: string;
  total_order_amount_cents: number;
  total_excl_tax_amount: string;
  total_excl_tax_amount_cents: number;
  today_count: number;
}

/** 后台分页列表响应体 */
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
