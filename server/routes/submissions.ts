/**
 * ============================================================================
 * 前台订单信息提交 API 路由模块
 * 路由：POST /api/submissions
 * 说明：接收 multipart/form-data，依次校验图形验证码、5 个字符串字段、4 个附件文件，
 *       原子性消费一次性验证码并使用 D1 batch 事务写入主表与附件二进制表。
 * ============================================================================
 */

import { Hono } from 'hono';
import type { Env, SubmissionFieldName } from '../types';
import { consumeCaptchaOnce, verifyCaptchaToken } from '../utils/captcha';
import { resolveSigningSecret } from '../utils/crypto';
import {
  validateSubmissionFields,
  validateUploadedFile,
  type ValidatedFileData,
} from '../utils/validation';

export const submissionRoutes = new Hono<{ Bindings: Env }>();

/** 前台必须上传的 4 个附件字段列表 */
const REQUIRED_FILE_FIELDS: SubmissionFieldName[] = [
  'order_screenshot',
  'review_screenshot',
  'wechat_qr_code',
  'invoice_file',
];

/**
 * 提交订单上传信息（含 5 个字符串字段 + 4 个附件文件 + 图形验证码校验）
 */
submissionRoutes.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    return c.json({ error: '请求格式错误，请使用 multipart/form-data 提交表单' }, 400);
  }

  // 1. 校验图形验证码签名、字符内容与有效期
  const captchaToken = typeof body.captcha_token === 'string' ? body.captcha_token : '';
  const captchaCode = typeof body.captcha_code === 'string' ? body.captcha_code : '';

  const secret = await resolveSigningSecret(c.env);
  const captchaCheck = await verifyCaptchaToken(secret, captchaToken, captchaCode);
  if (!captchaCheck.valid || !captchaCheck.captchaId || !captchaCheck.expiresAt) {
    return c.json(
      {
        error: captchaCheck.reason ?? '图形验证码校验失败',
        code: 'INVALID_CAPTCHA',
      },
      400,
    );
  }

  // 2. 校验 5 个字符串字段（下单时间、订单号、订单金额、下单用户-微信名、不含税金额）
  const fieldsResult = validateSubmissionFields(body);
  if (!fieldsResult.ok) {
    return c.json({ error: fieldsResult.error, code: 'INVALID_FIELDS' }, 400);
  }

  // 3. 校验 4 个附件文件（魔数校验 + 大小限制）
  const validatedFiles: Record<SubmissionFieldName, ValidatedFileData> = {} as Record<
    SubmissionFieldName,
    ValidatedFileData
  >;
  for (const fieldName of REQUIRED_FILE_FIELDS) {
    const fileResult = await validateUploadedFile(body[fieldName], fieldName);
    if (!fileResult.ok) {
      return c.json({ error: fileResult.error, code: 'INVALID_FILE' }, 400);
    }
    validatedFiles[fieldName] = fileResult.data;
  }

  // 4. 在所有字段和文件都校验通过后，原子性消费图形验证码（防止重放提交）
  const nowMs = Date.now();
  const consumed = await consumeCaptchaOnce(
    c.env.DB,
    captchaCheck.captchaId,
    captchaCheck.expiresAt,
    nowMs,
  );
  if (!consumed) {
    return c.json(
      {
        error: '该图形验证码已被使用，请点击验证码图片刷新后重新提交',
        code: 'CAPTCHA_REUSED',
      },
      400,
    );
  }

  // 5. 生成主记录与 4 个附件记录 UUID，通过 D1 batch 事务一次性写入数据库
  const submissionId = crypto.randomUUID();
  const createdAt = new Date(nowMs).toISOString();

  const fileIds: Record<SubmissionFieldName, string> = {
    order_screenshot: crypto.randomUUID(),
    review_screenshot: crypto.randomUUID(),
    wechat_qr_code: crypto.randomUUID(),
    invoice_file: crypto.randomUUID(),
  };

  const fields = fieldsResult.data;

  const insertSubmissionStmt = c.env.DB.prepare(
    `INSERT INTO submissions (
      id, order_time, order_no, order_amount, order_amount_cents,
      wechat_name, amount_excl_tax, amount_excl_tax_cents,
      order_screenshot_id, review_screenshot_id, wechat_qr_code_id, invoice_file_id,
      created_at, created_at_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    submissionId,
    fields.order_time,
    fields.order_no,
    fields.order_amount,
    fields.order_amount_cents,
    fields.wechat_name,
    fields.amount_excl_tax,
    fields.amount_excl_tax_cents,
    fileIds.order_screenshot,
    fileIds.review_screenshot,
    fileIds.wechat_qr_code,
    fileIds.invoice_file,
    createdAt,
    nowMs,
  );

  const insertFileStmts = REQUIRED_FILE_FIELDS.map((fieldName) => {
    const fileData = validatedFiles[fieldName];
    return c.env.DB.prepare(
      `INSERT INTO submission_files (
        id, submission_id, field_name, file_name, mime_type, file_size, data, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      fileIds[fieldName],
      submissionId,
      fieldName,
      fileData.file_name,
      fileData.mime_type,
      fileData.file_size,
      fileData.bytes,
      createdAt,
    );
  });

  await c.env.DB.batch([insertSubmissionStmt, ...insertFileStmts]);

  return c.json(
    {
      id: submissionId,
      order_no: fields.order_no,
      created_at: createdAt,
      message: '订单信息与凭证上传成功',
    },
    201,
  );
});
