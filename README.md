# 订单凭证信息上传与汇总管理系统（Cloudflare Workers + D1）

一个完全基于 **Cloudflare 免费服务**（Cloudflare Workers + Cloudflare D1）构建的轻量级全栈应用，无需开通 R2、无需绑定信用卡、无需配置外部验证码密钥，开箱即用。

- **前台 (`/`)**：仅保留一个简洁美观的上传页面，用于录入订单信息与上传截图/发票，支持**桌面端与手机端响应式浏览**，提交前自带本地 SVG 图形验证码防刷校验。
- **后台 (`/admin`)**：管理员密码登录后，可汇总统计订单总数、订单总金额、不含税总金额与今日新增，支持按订单号/微信名/下单日期筛选、全屏预览大图、在线查看或下载 PDF 发票、导出 UTF-8 CSV 表格及删除记录。

---

## 核心功能特性

1. **完整字段支持**
   - **5 个字符串字段**：`下单时间`、`订单号`、`订单金额`、`下单用户-微信名`、`不含税金额`
   - **4 个图片/文件字段**：`订单截图`、`评价截图`、`微信收款码`、`发票文件`（发票同时支持图片和 PDF 格式）
2. **本地 SVG 图形验证码（零外部配置）**
   - Worker 后端基于 Web Crypto HMAC-SHA256 生成动态 SVG 图形验证码，不消耗 D1 写次数；
   - 提交校验通过后记录一次性消费凭证到 D1 `used_captchas` 表，彻底防止验证码重放刷接口。
3. **浏览器端自动压缩 + D1 安全拆表存储**
   - 手机拍照原图（3MB~10MB）在前端自动等比缩放并压缩，**微信收款码自动启用高清晰度档位**保证扫码识别率；
   - 数据库将主表 `submissions` 与二进制附件表 `submission_files` 拆分存储，列表查询仅读元数据，避免触发 Cloudflare D1 单行大小上限并大幅节省免费读取额度。
4. **全响应式设计（手机/桌面双端适配）**
   - 基于 **Vue 3 + Element Plus** 构建，前台手机端单列大按钮操作，金额输入框自动呼出数字键盘；
   - 后台在桌面端展示高密度数据表格，在手机端自动切换为清晰易读的订单卡片列表。
5. **财务级精度与安全防护**
   - 后端金额统一转为整数“分”进行存储和汇总计算，杜绝浮点数 `0.1 + 0.2` 精度误差；
   - 所有上传文件均执行二进制文件头魔数（Magic Bytes）校验，拦截伪造扩展名的非法文件；
   - 导出 CSV 自动注入 UTF-8 BOM 头（Excel 打开中文不乱码）并具备 CSV 公式注入防护；
   - 后台采用 `HttpOnly` + `SameSite=Lax` 签名 Cookie 鉴权，密码比对采用常量时间算法防时序攻击。

---

## 技术栈

| 层级 | 技术选型 |
| --- | --- |
| 运行时与边缘计算 | Cloudflare Workers（Static Assets + Worker API 单体统一部署） |
| 数据库 | Cloudflare D1（SQLite） |
| 后端框架 | Hono + TypeScript + Web Crypto API |
| 前端框架与组件库 | Vue 3 + Vite + Vue Router + Element Plus |
| 单元测试 | Vitest + sql.js (WASM SQLite 内存 D1 适配器) + happy-dom + @vue/test-utils |

---

## 目录结构

```text
.
├── migrations/
│   └── 0001_init.sql             # Cloudflare D1 初始化迁移 SQL（表结构与索引）
├── server/
│   ├── index.ts                  # Workers 入口文件
│   ├── app.ts                    # Hono 应用装配与静态资源转发
│   ├── types.ts                  # 后端环境变量与业务数据模型类型
│   ├── middleware/
│   │   └── auth.ts               # 管理员 Cookie 鉴权中间件
│   ├── routes/
│   │   ├── captcha.ts            # GET /api/captcha 图形验证码接口
│   │   ├── submissions.ts        # POST /api/submissions 前台提交接口
│   │   └── admin.ts              # 后台登录、查询、汇总、导出、附件流、删除接口
│   └── utils/
│       ├── captcha.ts            # SVG 图形验证码绘制、签名校验与防重放
│       ├── crypto.ts             # HMAC-SHA256、常量时间比对、Session Token
│       ├── csv.ts                # UTF-8 BOM CSV 生成与公式注入防护
│       └── validation.ts         # 5 字段校验、金额分转换、文件魔数校验
├── src/
│   ├── main.ts                   # Vue 入口
│   ├── App.vue                   # 根组件（注入 Element Plus 中文语言包）
│   ├── router/index.ts           # 前台 (/) 与后台 (/admin) 路由配置
│   ├── api/client.ts             # 前端 API 请求封装
│   ├── components/
│   │   └── FileUploadCard.vue    # 自适应图片压缩与预览上传卡片组件
│   ├── views/
│   │   ├── UploadView.vue        # 前台唯一订单上传页面
│   │   └── AdminView.vue         # 后台登录与响应式汇总管理页面
│   └── utils/
│       ├── format.ts             # 时间、金额、文件大小格式化与校验工具
│       └── imageCompress.ts      # Canvas 图片等比缩放与压缩工具
├── tests/                        # 后端与前端单元测试套件
├── wrangler.toml                 # Cloudflare Workers & D1 部署配置
└── package.json
```

---

## 本地开发指南

### 1. 安装依赖

```bash
npm install
```

### 2. 配置本地环境变量

复制示例文件并修改后台管理员密码：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```ini
ADMIN_PASSWORD=your-strong-admin-password
# 可选：若不填写 AUTH_SECRET，系统会自动基于 ADMIN_PASSWORD 派生安全签名密钥
AUTH_SECRET=your-random-32byte-secret
```

### 3. 初始化本地 D1 数据库

```bash
npm run db:init:local
```

### 4. 启动本地调试

打开两个终端分别启动前端开发服务器（支持热更新）与本地 Worker 后端：

```bash
# 终端 1：启动 Worker 后端 + 本地 D1（默认监听 http://127.0.0.1:8787）
npm run dev:worker

# 终端 2：启动 Vite 前端（默认监听 http://localhost:5173，自动将 /api 代理至 8787）
npm run dev:web
```

浏览器访问：
- 前台上传页：`http://localhost:5173/`
- 后台管理页：`http://localhost:5173/admin`

*(也可以先执行 `npm run build`，然后仅运行 `npm run dev:worker` 直接在 `http://127.0.0.1:8787` 体验生产态托管效果)*

---

## 部署到 Cloudflare（免费套餐）

### 1. 登录 Cloudflare 账号

```bash
npx wrangler login
```

### 2. 创建远程 D1 数据库

```bash
npx wrangler d1 create m-tool
```

命令执行成功后会输出类似如下信息，请复制其中的 `database_id`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "m-tool"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

将其填入项目根目录的 `wrangler.toml` 对应位置替换占位 UUID。

### 3. 执行远程 D1 建表迁移

```bash
npm run db:init:remote
```

### 4. 设置线上管理员密码（Worker Secret）

```bash
npx wrangler secret put ADMIN_PASSWORD
```

*(如需独立签名密钥，也可额外执行 `npx wrangler secret put AUTH_SECRET`)*

### 5. 一键打包并发布上线

```bash
npm run deploy
```

部署完成后终端会打印你的 `*.workers.dev` 访问地址，之后即可直接在浏览器或手机微信/浏览器中打开使用，也可在 Cloudflare 控制台绑定自定义域名。

---

## 单元测试与类型检查

项目核心模块均配备自动化单元测试，覆盖密码学签名、图形验证码防重放、金额精度与文件魔数校验、全链路 D1 API 接口、前端工具函数及组件响应式渲染。

```bash
# 运行全部前后端单元测试
npm test

# 运行 TypeScript 全量类型检查（前端 + Workers 后端）
npm run typecheck

# 监听模式运行单元测试
npm run test:watch
```

---

## API 接口一览

| 方法与路径 | 说明 | 权限 |
| --- | --- | --- |
| `GET /api/health` | Worker 与 D1 数据库连通性检查 | 公开 |
| `GET /api/captcha` | 获取本地 SVG 图形验证码及签名凭证 | 公开 |
| `POST /api/submissions` | 提交 5 个字符串字段 + 4 个附件文件 + 验证码 | 公开（一次性验证码校验） |
| `POST /api/admin/login` | 管理员密码登录并签发 HttpOnly Cookie | 公开 |
| `POST /api/admin/logout` | 退出登录并清除会话 Cookie | 公开 |
| `GET /api/admin/me` | 查询当前登录会话状态 | 公开 |
| `GET /api/admin/submissions` | 分页查询订单、搜索筛选与实时金额汇总统计 | 需登录 |
| `GET /api/admin/submissions/export` | 导出当前筛选结果为 UTF-8 CSV 文件 | 需登录 |
| `GET /api/admin/submissions/:id` | 获取单条订单详情 | 需登录 |
| `DELETE /api/admin/submissions/:id` | 删除指定订单及关联的所有附件 | 需登录 |
| `GET /api/admin/files/:id` | 在线预览或下载（`?download=1`）单个附件二进制流 | 需登录 |

---

## Cloudflare 免费额度参考

- **Cloudflare Workers**：每日免费 100,000 次请求；静态 HTML/JS/CSS 由 Static Assets 边缘直接返回，不消耗 Worker 请求次数。
- **Cloudflare D1**：免费版提供 **5 GB** 数据库总存储空间、每日 **500 万行读取** 与 **10 万行写入**。
- 按每笔订单上传 4 个附件（经过前端自动压缩后合计约 `400KB ~ 600KB`）估算，D1 免费 5GB 空间约可容纳 **8,000 ~ 12,000 笔**完整含图订单记录；对于历史已归档的旧数据，管理员可在后台导出 CSV 后清理以释放空间。
