-- ============================================================================
-- Cloudflare D1 数据库初始化迁移脚本
-- 说明：创建订单提交主表 (submissions)、附件二进制存储表 (submission_files)
--       以及一次性图形验证码防重放记录表 (used_captchas)
-- ============================================================================

-- 1. 订单上传信息主表
-- 注意：金额字段同时保留展示字符串与整数“分”，避免 SQLite 浮点运算产生精度误差
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,                     -- 提交记录唯一 ID (UUID v4)
  order_time TEXT NOT NULL,                -- 下单时间（字符串，例如 2026-11-10 14:30:00）
  order_no TEXT NOT NULL,                  -- 订单号
  order_amount TEXT NOT NULL,              -- 订单金额（格式化字符串，例如 199.00）
  order_amount_cents INTEGER NOT NULL,     -- 订单金额（单位：分，用于精确求和统计）
  wechat_name TEXT NOT NULL,               -- 下单用户-微信名
  amount_excl_tax TEXT NOT NULL,           -- 不含税金额（格式化字符串，例如 176.11）
  amount_excl_tax_cents INTEGER NOT NULL,  -- 不含税金额（单位：分，用于精确求和统计）
  order_screenshot_id TEXT NOT NULL,       -- 订单截图文件 ID（关联 submission_files.id）
  review_screenshot_id TEXT NOT NULL,      -- 评价截图文件 ID（关联 submission_files.id）
  wechat_qr_code_id TEXT NOT NULL,         -- 微信收款码文件 ID（关联 submission_files.id）
  invoice_file_id TEXT NOT NULL,           -- 发票文件 ID（关联 submission_files.id）
  created_at TEXT NOT NULL,                -- 记录提交时间（ISO-8601 格式）
  created_at_ms INTEGER NOT NULL           -- 记录提交时间戳（毫秒，用于排序与今日统计）
);

-- 2. 上传附件（图片/发票PDF）二进制存储表
-- 说明：将每个文件拆分为独立行存储为 SQLite BLOB，
--       一方面比 Base64 节省约 33% 的 D1 存储空间，
--       另一方面避免单行过大触及 D1 单语句/单行大小上限，同时列表查询无需读取二进制内容。
CREATE TABLE IF NOT EXISTS submission_files (
  id TEXT PRIMARY KEY,                     -- 文件唯一 ID (UUID v4)
  submission_id TEXT NOT NULL,             -- 所属提交记录 ID
  field_name TEXT NOT NULL,                -- 字段标识：order_screenshot / review_screenshot / wechat_qr_code / invoice_file
  file_name TEXT NOT NULL,                 -- 文件名
  mime_type TEXT NOT NULL,                 -- 经过魔数校验的真实 MIME 类型
  file_size INTEGER NOT NULL,              -- 文件字节大小
  data BLOB NOT NULL,                      -- 文件二进制内容
  created_at TEXT NOT NULL,                -- 上传时间（ISO-8601 格式）
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

-- 3. 图形验证码防重放表
-- 说明：仅在表单提交验证通过时写入已消费的 captcha_id，
--       GET /api/captcha 本身不写库，既防止验证码重放攻击又节省 D1 免费写入额度。
CREATE TABLE IF NOT EXISTS used_captchas (
  id TEXT PRIMARY KEY,                     -- 验证码唯一 ID
  expires_at INTEGER NOT NULL              -- 验证码过期时间（毫秒时间戳）
);

-- 索引设计：加速后台分页排序、订单号/微信名搜索与时间范围筛选
CREATE INDEX IF NOT EXISTS idx_submissions_created_at_ms ON submissions(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_order_no ON submissions(order_no);
CREATE INDEX IF NOT EXISTS idx_submissions_wechat_name ON submissions(wechat_name);
CREATE INDEX IF NOT EXISTS idx_submissions_order_time ON submissions(order_time);
CREATE INDEX IF NOT EXISTS idx_submission_files_submission_id ON submission_files(submission_id);
CREATE INDEX IF NOT EXISTS idx_used_captchas_expires_at ON used_captchas(expires_at);
