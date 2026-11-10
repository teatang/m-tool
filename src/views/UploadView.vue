<script setup lang="ts">
/**
 * ============================================================================
 * 前台唯一订单凭证上传页面 (/)
 * 功能涵盖：
 * 1. 5 个字符串字段录入与校验：下单时间、订单号、订单金额、下单用户-微信名、不含税金额；
 * 2. 4 个附件上传与自动优化：订单截图、评价截图、微信收款码、发票文件（支持图片/PDF）；
 * 3. 提交前本地 SVG 图形验证码校验与防重放刷接口保护；
 * 4. 全面响应式设计，兼容桌面浏览器与手机端竖屏浏览操作。
 * ============================================================================
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  Check,
  Clock,
  Coin,
  DocumentChecked,
  Lock,
  Refresh,
  Ticket,
  User,
} from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { ApiError, fetchCaptcha, submitOrderForm } from '@/api/client';
import FileUploadCard from '@/components/FileUploadCard.vue';
import type { CaptchaResponse, SubmitSuccessResponse } from '@/types/api';
import {
  formatIsoToBeijingTime,
  getCurrentDateTimeString,
  isValidAmountInput,
  normalizeAmountOnBlur,
} from '@/utils/format';

/** 前台表单数据模型 */
interface OrderFormModel {
  order_time: string;
  order_no: string;
  order_amount: string;
  wechat_name: string;
  amount_excl_tax: string;
  order_screenshot: File | null;
  review_screenshot: File | null;
  wechat_qr_code: File | null;
  invoice_file: File | null;
  captcha_code: string;
}

const formRef = ref<FormInstance>();
const isMobile = ref(false);
const isSubmitting = ref(false);
const isCaptchaLoading = ref(false);
const captchaData = ref<CaptchaResponse | null>(null);
const submitReceipt = ref<SubmitSuccessResponse | null>(null);
const hasAttemptedSubmit = ref(false);

const form = reactive<OrderFormModel>({
  order_time: '',
  order_no: '',
  order_amount: '',
  wechat_name: '',
  amount_excl_tax: '',
  order_screenshot: null,
  review_screenshot: null,
  wechat_qr_code: null,
  invoice_file: null,
  captcha_code: '',
});

/** 监听视口宽度，实现响应式标签位置与弹窗尺寸切换 */
function updateViewportFlag() {
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth <= 768;
  }
}

/** 自定义金额校验器 */
const validateAmountRule = (label: string) => {
  return (_rule: unknown, value: string, callback: (error?: Error) => void) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      callback(new Error(`请输入${label}`));
      return;
    }
    if (!isValidAmountInput(trimmed)) {
      callback(new Error(`${label}格式不正确（例如 199.00，最多两位小数）`));
      return;
    }
    callback();
  };
};

/** 自定义文件必传校验器 */
const validateRequiredFile = (fieldKey: keyof OrderFormModel, label: string) => {
  return (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
    if (!form[fieldKey]) {
      callback(new Error(`请上传${label}`));
      return;
    }
    callback();
  };
};

const rules = computed<FormRules<OrderFormModel>>(() => ({
  order_time: [{ required: true, message: '请选择或填写下单时间', trigger: 'change' }],
  order_no: [
    { required: true, message: '请输入订单号', trigger: 'blur' },
    { max: 100, message: '订单号长度不能超过 100 个字符', trigger: 'blur' },
  ],
  order_amount: [{ required: true, validator: validateAmountRule('订单金额'), trigger: 'blur' }],
  wechat_name: [
    { required: true, message: '请输入下单用户-微信名', trigger: 'blur' },
    { max: 100, message: '微信名长度不能超过 100 个字符', trigger: 'blur' },
  ],
  amount_excl_tax: [
    { required: true, validator: validateAmountRule('不含税金额'), trigger: 'blur' },
  ],
  order_screenshot: [
    { required: true, validator: validateRequiredFile('order_screenshot', '订单截图'), trigger: 'change' },
  ],
  review_screenshot: [
    { required: true, validator: validateRequiredFile('review_screenshot', '评价截图'), trigger: 'change' },
  ],
  wechat_qr_code: [
    { required: true, validator: validateRequiredFile('wechat_qr_code', '微信收款码'), trigger: 'change' },
  ],
  invoice_file: [
    { required: true, validator: validateRequiredFile('invoice_file', '发票文件'), trigger: 'change' },
  ],
  captcha_code: [
    { required: true, message: '请输入图形验证码', trigger: 'blur' },
    { min: 4, max: 6, message: '请输入完整的图形验证码', trigger: 'blur' },
  ],
}));

/** 加载或刷新本地图形验证码 */
async function loadCaptcha() {
  isCaptchaLoading.value = true;
  try {
    captchaData.value = await fetchCaptcha();
    form.captcha_code = '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取验证码失败';
    ElMessage.error(msg);
  } finally {
    isCaptchaLoading.value = false;
  }
}

/** 快捷填入当前北京时间 */
function fillCurrentTime() {
  form.order_time = getCurrentDateTimeString();
  formRef.value?.validateField('order_time').catch(() => {});
}

/** 金额失焦时自动规范为两位小数 */
function handleAmountBlur(field: 'order_amount' | 'amount_excl_tax') {
  form[field] = normalizeAmountOnBlur(form[field]);
}

/** 单个附件变更时触发对应字段的表单校验更新 */
function handleFileChange(field: 'order_screenshot' | 'review_screenshot' | 'wechat_qr_code' | 'invoice_file') {
  formRef.value?.validateField(field).catch(() => {});
}

/** 提交完整订单表单 */
async function handleSubmit() {
  hasAttemptedSubmit.value = true;
  if (!formRef.value) return;

  const isValid = await formRef.value.validate().then(
    () => true,
    () => false,
  );
  if (!isValid) {
    ElMessage.warning('请检查并补全标红的必填信息与附件');
    return;
  }

  if (!captchaData.value?.token) {
    ElMessage.warning('图形验证码尚未加载，请刷新后重试');
    await loadCaptcha();
    return;
  }

  isSubmitting.value = true;
  try {
    const payload = new FormData();
    payload.append('order_time', form.order_time.trim());
    payload.append('order_no', form.order_no.trim());
    payload.append('order_amount', form.order_amount.trim());
    payload.append('wechat_name', form.wechat_name.trim());
    payload.append('amount_excl_tax', form.amount_excl_tax.trim());
    payload.append('captcha_token', captchaData.value.token);
    payload.append('captcha_code', form.captcha_code.trim());

    if (form.order_screenshot) payload.append('order_screenshot', form.order_screenshot);
    if (form.review_screenshot) payload.append('review_screenshot', form.review_screenshot);
    if (form.wechat_qr_code) payload.append('wechat_qr_code', form.wechat_qr_code);
    if (form.invoice_file) payload.append('invoice_file', form.invoice_file);

    const result = await submitOrderForm(payload);
    submitReceipt.value = result;
    ElMessage.success('信息提交成功！');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '提交失败，请检查网络后重试';
    ElMessage.error(message);
    // 只要提交失败（如验证码输错或被消费），自动刷新验证码防止使用旧凭证
    await loadCaptcha();
  } finally {
    isSubmitting.value = false;
  }
}

/** 重置表单，准备继续上传下一条订单 */
async function resetAndContinue() {
  submitReceipt.value = null;
  hasAttemptedSubmit.value = false;
  form.order_time = '';
  form.order_no = '';
  form.order_amount = '';
  form.wechat_name = '';
  form.amount_excl_tax = '';
  form.order_screenshot = null;
  form.review_screenshot = null;
  form.wechat_qr_code = null;
  form.invoice_file = null;
  form.captcha_code = '';
  formRef.value?.clearValidate();
  await loadCaptcha();
}

onMounted(() => {
  updateViewportFlag();
  window.addEventListener('resize', updateViewportFlag);
  void loadCaptcha();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportFlag);
});
</script>

<template>
  <div class="page-shell">
    <main class="upload-container">
      <!-- 顶部简洁标题横幅 -->
      <header class="hero-card">
        <div class="hero-top">
          <div class="hero-badge">
            <el-icon><DocumentChecked /></el-icon>
            <span>订单凭证自助登记</span>
          </div>
          <router-link to="/admin" class="admin-entry-link">管理后台</router-link>
        </div>
        <h1 class="hero-title">订单信息与凭证上传</h1>
        <p class="hero-desc">
          请完整填写订单基础信息并上传对应截图与发票文件；提交前需完成图片验证码校验。
        </p>
      </header>

      <!-- 提交成功回执视图 -->
      <section v-if="submitReceipt" class="form-card receipt-card">
        <el-result
          icon="success"
          title="订单信息上传成功"
          sub-title="您的订单记录与全部凭证已安全保存，工作人员将在后台汇总核验。"
        >
          <template #extra>
            <div class="receipt-summary">
              <div class="receipt-row">
                <span class="receipt-label">订单号</span>
                <span class="receipt-value mono">{{ submitReceipt.order_no }}</span>
              </div>
              <div class="receipt-row">
                <span class="receipt-label">系统编号</span>
                <span class="receipt-value mono">{{ submitReceipt.id }}</span>
              </div>
              <div class="receipt-row">
                <span class="receipt-label">提交时间</span>
                <span class="receipt-value">{{ formatIsoToBeijingTime(submitReceipt.created_at) }}</span>
              </div>
            </div>
            <el-button type="primary" size="large" @click="resetAndContinue">
              继续上传下一条
            </el-button>
          </template>
        </el-result>
      </section>

      <!-- 主上传表单视图 -->
      <section v-else class="form-card">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          scroll-to-error
          @submit.prevent="handleSubmit"
        >
          <!-- 第一部分：5 个字符串字段 -->
          <div class="section-header">
            <span class="section-index">01</span>
            <div>
              <h2 class="section-title">订单基本信息</h2>
              <p class="section-subtitle">请核对订单详情后如实填写，所有字段均为必填</p>
            </div>
          </div>

          <div class="fields-grid">
            <el-form-item label="下单时间" prop="order_time" class="grid-item">
              <div class="time-input-row">
                <el-date-picker
                  v-model="form.order_time"
                  type="datetime"
                  placeholder="选择下单日期与时间"
                  format="YYYY-MM-DD HH:mm:ss"
                  value-format="YYYY-MM-DD HH:mm:ss"
                  :editable="true"
                  class="full-width"
                />
                <el-button type="primary" plain @click="fillCurrentTime" title="快捷填入当前时间">
                  <el-icon class="btn-icon"><Clock /></el-icon>
                  <span>此刻</span>
                </el-button>
              </div>
            </el-form-item>

            <el-form-item label="订单号" prop="order_no" class="grid-item">
              <el-input
                v-model="form.order_no"
                placeholder="请输入完整订单编号"
                clearable
                :prefix-icon="Ticket"
              />
            </el-form-item>

            <el-form-item label="订单金额（元）" prop="order_amount" class="grid-item">
              <el-input
                v-model="form.order_amount"
                placeholder="例如：199.00"
                inputmode="decimal"
                :prefix-icon="Coin"
                @blur="handleAmountBlur('order_amount')"
              />
            </el-form-item>

            <el-form-item label="不含税金额（元）" prop="amount_excl_tax" class="grid-item">
              <el-input
                v-model="form.amount_excl_tax"
                placeholder="例如：176.11"
                inputmode="decimal"
                :prefix-icon="Coin"
                @blur="handleAmountBlur('amount_excl_tax')"
              />
            </el-form-item>

            <el-form-item label="下单用户-微信名" prop="wechat_name" class="grid-item grid-item-full">
              <el-input
                v-model="form.wechat_name"
                placeholder="请输入下单用户的微信昵称"
                clearable
                :prefix-icon="User"
              />
            </el-form-item>
          </div>

          <el-divider class="section-divider" />

          <!-- 第二部分：4 个图片/文件字段 -->
          <div class="section-header">
            <span class="section-index">02</span>
            <div>
              <h2 class="section-title">凭证与附件上传</h2>
              <p class="section-subtitle">
                手机端支持直接拍照或从相册选取，系统会自动压缩大图以加快上传速度
              </p>
            </div>
          </div>

          <div class="uploads-grid">
            <el-form-item label="订单截图" prop="order_screenshot">
              <FileUploadCard
                v-model="form.order_screenshot"
                label="订单截图"
                hint="包含订单号与金额的完整页面截图"
                :has-error="hasAttemptedSubmit"
                @change="handleFileChange('order_screenshot')"
              />
            </el-form-item>

            <el-form-item label="评价截图" prop="review_screenshot">
              <FileUploadCard
                v-model="form.review_screenshot"
                label="评价截图"
                hint="买家完成评价后的页面截图"
                :has-error="hasAttemptedSubmit"
                @change="handleFileChange('review_screenshot')"
              />
            </el-form-item>

            <el-form-item label="微信收款码" prop="wechat_qr_code">
              <FileUploadCard
                v-model="form.wechat_qr_code"
                label="微信收款码"
                hint="请上传清晰完整的微信收款二维码"
                :high-detail="true"
                :has-error="hasAttemptedSubmit"
                @change="handleFileChange('wechat_qr_code')"
              />
            </el-form-item>

            <el-form-item label="发票文件" prop="invoice_file">
              <FileUploadCard
                v-model="form.invoice_file"
                label="发票文件"
                hint="支持 JPG/PNG 图片或 PDF 电子发票（≤1.2MB）"
                :allow-pdf="true"
                :has-error="hasAttemptedSubmit"
                @change="handleFileChange('invoice_file')"
              />
            </el-form-item>
          </div>

          <el-divider class="section-divider" />

          <!-- 第三部分：图片验证码与提交按钮 -->
          <div class="section-header">
            <span class="section-index">03</span>
            <div>
              <h2 class="section-title">安全验证并提交</h2>
              <p class="section-subtitle">请输入下方图片中的字符（不区分大小写）</p>
            </div>
          </div>

          <el-form-item label="图形验证码" prop="captcha_code" class="captcha-form-item">
            <div class="captcha-row">
              <el-input
                v-model="form.captcha_code"
                placeholder="请输入 4 位验证码"
                maxlength="6"
                clearable
                :prefix-icon="Lock"
                class="captcha-input"
                @keyup.enter="handleSubmit"
              />
              <button
                type="button"
                class="captcha-img-btn"
                :disabled="isCaptchaLoading"
                title="点击刷新验证码"
                @click="loadCaptcha"
              >
                <img
                  v-if="captchaData?.image_data_url"
                  :src="captchaData.image_data_url"
                  alt="图形验证码"
                  class="captcha-img"
                />
                <span v-else class="captcha-loading-text">加载中...</span>
              </button>
              <el-button
                text
                type="primary"
                :icon="Refresh"
                :loading="isCaptchaLoading"
                @click="loadCaptcha"
              >
                换一张
              </el-button>
            </div>
          </el-form-item>

          <div class="submit-bar">
            <el-button
              type="primary"
              size="large"
              class="submit-btn"
              :loading="isSubmitting"
              :icon="Check"
              native-type="submit"
            >
              {{ isSubmitting ? '正在校验并上传至云端...' : '确认提交订单信息' }}
            </el-button>
          </div>
        </el-form>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page-shell {
  min-height: 100vh;
  padding: 28px 16px 48px;
  background:
    radial-gradient(circle at 12% 10%, rgba(59, 130, 246, 0.12), transparent 36%),
    radial-gradient(circle at 88% 85%, rgba(99, 102, 241, 0.1), transparent 36%),
    #f1f5f9;
}

.upload-container {
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hero-card {
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%);
  color: #ffffff;
  border-radius: 16px;
  padding: 24px 28px;
  box-shadow: 0 10px 30px -12px rgba(37, 99, 235, 0.45);
}

.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(4px);
  font-size: 12px;
  font-weight: 600;
}

.admin-entry-link {
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  text-decoration: none;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  transition: all 0.2s;
}

.admin-entry-link:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.14);
}

.hero-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.hero-desc {
  margin: 8px 0 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
}

.form-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 4px 24px -6px rgba(15, 23, 42, 0.08);
  border: 1px solid #e2e8f0;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}

.section-index {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #eff6ff;
  color: #2563eb;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}

.section-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
}

.section-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #64748b;
}

.fields-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 20px;
}

.grid-item-full {
  grid-column: 1 / -1;
}

.time-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.full-width {
  width: 100% !important;
  flex: 1;
}

.btn-icon {
  margin-right: 4px;
}

.section-divider {
  margin: 22px 0 24px;
}

.uploads-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
}

.captcha-form-item {
  max-width: 520px;
}

.captcha-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  flex-wrap: wrap;
}

.captcha-input {
  flex: 1;
  min-width: 150px;
}

.captcha-img-btn {
  padding: 0;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fafc;
  height: 44px;
  width: 136px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.captcha-img-btn:hover {
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.16);
}

.captcha-img-btn:active {
  transform: scale(0.98);
}

.captcha-img {
  display: block;
  width: 136px;
  height: 44px;
}

.captcha-loading-text {
  font-size: 12px;
  color: #64748b;
}

.submit-bar {
  margin-top: 26px;
  display: flex;
  justify-content: center;
}

.submit-btn {
  min-width: 260px;
  height: 46px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
}

.receipt-card {
  padding: 20px;
}

.receipt-summary {
  width: 100%;
  max-width: 420px;
  margin: 0 auto 22px;
  padding: 16px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.receipt-label {
  color: #64748b;
  flex-shrink: 0;
}

.receipt-value {
  color: #0f172a;
  font-weight: 600;
  word-break: break-all;
  text-align: right;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* 移动端响应式适配 */
@media (max-width: 768px) {
  .page-shell {
    padding: 12px 10px 32px;
  }

  .hero-card {
    padding: 18px 16px;
    border-radius: 14px;
  }

  .hero-title {
    font-size: 20px;
  }

  .hero-desc {
    font-size: 13px;
  }

  .form-card {
    padding: 18px 14px;
    border-radius: 14px;
  }

  .fields-grid,
  .uploads-grid {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .captcha-form-item {
    max-width: 100%;
  }

  .submit-btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
