/**
 * ============================================================================
 * 前端 API 请求客户端模块
 * 说明：封装与 Cloudflare Workers 后端通信的所有请求方法与统一异常处理
 * ============================================================================
 */

import type {
  CaptchaResponse,
  PaginatedSubmissionsResponse,
  SubmissionItem,
  SubmitSuccessResponse,
} from '@/types/api';

/**
 * 统一 API 请求异常类，携带 HTTP 状态码与业务错误码
 */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 内部通用 JSON 请求封装（自动携带 Cookie 凭证并解析后端错误信息）
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
  });

  let data: Record<string, unknown> = {};
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : `请求失败（状态码 ${response.status}）`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  return data as T;
}

/** 获取新的图形验证码 */
export function fetchCaptcha(): Promise<CaptchaResponse> {
  return requestJson<CaptchaResponse>(`/api/captcha?_t=${Date.now()}`);
}

/** 提交订单信息与 4 个附件文件 */
export function submitOrderForm(formData: FormData): Promise<SubmitSuccessResponse> {
  return requestJson<SubmitSuccessResponse>('/api/submissions', {
    method: 'POST',
    body: formData,
  });
}

/** 管理员登录 */
export function adminLogin(password: string): Promise<{ authenticated: boolean }> {
  return requestJson<{ authenticated: boolean }>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

/** 管理员退出登录 */
export function adminLogout(): Promise<{ authenticated: boolean }> {
  return requestJson<{ authenticated: boolean }>('/api/admin/logout', {
    method: 'POST',
  });
}

/** 查询当前管理员登录状态 */
export function fetchAdminStatus(): Promise<{ authenticated: boolean }> {
  return requestJson<{ authenticated: boolean }>('/api/admin/me');
}

/** 后台查询条件参数 */
export interface AdminQueryParams {
  keyword?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

/** 后台分页查询订单汇总列表 */
export function fetchAdminSubmissions(
  params: AdminQueryParams = {},
): Promise<PaginatedSubmissionsResponse> {
  const search = new URLSearchParams();
  if (params.keyword?.trim()) search.set('keyword', params.keyword.trim());
  if (params.start_date?.trim()) search.set('start_date', params.start_date.trim());
  if (params.end_date?.trim()) search.set('end_date', params.end_date.trim());
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));

  const query = search.toString();
  return requestJson<PaginatedSubmissionsResponse>(
    `/api/admin/submissions${query ? `?${query}` : ''}`,
  );
}

/** 获取单条订单详情 */
export function fetchAdminSubmissionDetail(id: string): Promise<{ item: SubmissionItem }> {
  return requestJson<{ item: SubmissionItem }>(`/api/admin/submissions/${encodeURIComponent(id)}`);
}

/** 删除单条订单记录 */
export function deleteAdminSubmission(id: string): Promise<{ deleted: boolean; id: string }> {
  return requestJson<{ deleted: boolean; id: string }>(
    `/api/admin/submissions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** 构造附件预览或下载 URL */
export function getAdminFileUrl(fileId: string, download: boolean = false): string {
  const base = `/api/admin/files/${encodeURIComponent(fileId)}`;
  return download ? `${base}?download=1` : base;
}

/** 构造导出 CSV 下载 URL */
export function getAdminExportCsvUrl(params: AdminQueryParams = {}): string {
  const search = new URLSearchParams();
  if (params.keyword?.trim()) search.set('keyword', params.keyword.trim());
  if (params.start_date?.trim()) search.set('start_date', params.start_date.trim());
  if (params.end_date?.trim()) search.set('end_date', params.end_date.trim());
  const query = search.toString();
  return `/api/admin/submissions/export${query ? `?${query}` : ''}`;
}
