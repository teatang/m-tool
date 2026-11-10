<script setup lang="ts">
/**
 * ============================================================================
 * 后台订单信息汇总与查阅管理页面 (/admin)
 * 功能特性：
 * 1. 管理员密码登录校验（HttpOnly Cookie 会话保持）；
 * 2. 顶部汇总指标卡片：订单总数、订单总金额、不含税总金额、今日新增；
 * 3. 多条件筛选：订单号/微信名关键词模糊查询、下单起止日期筛选、一键导出 UTF-8 CSV；
 * 4. 全响应式视图：桌面端展示高密度数据表格，手机端自动切换为易读的卡片列表；
 * 5. 支持 4 类凭证大图全屏轮播预览、微信收款码高清查看、发票 PDF 在线查看与原文件下载。
 * ============================================================================
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  CopyDocument,
  Delete,
  Document,
  Download,
  Lock,
  Picture,
  Refresh,
  Search,
  SwitchButton,
  View,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  adminLogin,
  adminLogout,
  ApiError,
  deleteAdminSubmission,
  fetchAdminStatus,
  fetchAdminSubmissions,
  getAdminExportCsvUrl,
  getAdminFileUrl,
} from '@/api/client';
import type { SubmissionFileMeta, SubmissionItem, SummaryStats } from '@/types/api';
import { formatCurrencyDisplay, formatFileSize, formatIsoToBeijingTime } from '@/utils/format';

const isCheckingAuth = ref(true);
const isAuthenticated = ref(false);
const isLoggingIn = ref(false);
const loginPassword = ref('');

const isMobile = ref(false);
const isLoadingList = ref(false);
const isExporting = ref(false);
const items = ref<SubmissionItem[]>([]);
const total = ref(0);

const summary = ref<SummaryStats>({
  total_count: 0,
  total_order_amount: '0.00',
  total_order_amount_cents: 0,
  total_excl_tax_amount: '0.00',
  total_excl_tax_amount_cents: 0,
  today_count: 0,
});

const filters = reactive({
  keyword: '',
  startDate: '',
  endDate: '',
  page: 1,
  pageSize: 15,
});

// 详情抽屉状态
const detailVisible = ref(false);
const activeItem = ref<SubmissionItem | null>(null);

// 全屏图片预览状态
const viewerVisible = ref(false);
const viewerUrls = ref<string[]>([]);
const viewerIndex = ref(0);

/** 响应式视口检测 */
function updateViewportFlag() {
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth <= 768;
  }
}

/** 抽屉在手机端占满宽度，桌面端固定 600px */
const drawerSize = computed(() => (isMobile.value ? '100%' : '600px'));

/** 初始化校验管理员登录状态 */
async function checkAuth() {
  isCheckingAuth.value = true;
  try {
    const res = await fetchAdminStatus();
    isAuthenticated.value = res.authenticated;
    if (res.authenticated) {
      await loadSubmissions();
    }
  } catch {
    isAuthenticated.value = false;
  } finally {
    isCheckingAuth.value = false;
  }
}

/** 提交管理员登录 */
async function handleLogin() {
  const pwd = loginPassword.value.trim();
  if (!pwd) {
    ElMessage.warning('请输入管理员密码');
    return;
  }
  isLoggingIn.value = true;
  try {
    await adminLogin(pwd);
    isAuthenticated.value = true;
    loginPassword.value = '';
    ElMessage.success('登录成功');
    await loadSubmissions();
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '登录失败';
    ElMessage.error(msg);
  } finally {
    isLoggingIn.value = false;
  }
}

/** 退出登录 */
async function handleLogout() {
  try {
    await adminLogout();
  } finally {
    isAuthenticated.value = false;
    items.value = [];
    detailVisible.value = false;
    ElMessage.success('已安全退出登录');
  }
}

/** 查询订单汇总列表 */
async function loadSubmissions() {
  isLoadingList.value = true;
  try {
    const res = await fetchAdminSubmissions({
      keyword: filters.keyword,
      start_date: filters.startDate,
      end_date: filters.endDate,
      page: filters.page,
      page_size: filters.pageSize,
    });
    items.value = res.items;
    total.value = res.pagination.total;
    summary.value = res.summary;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      isAuthenticated.value = false;
      ElMessage.warning('登录已过期，请重新登录');
      return;
    }
    ElMessage.error(err instanceof Error ? err.message : '加载列表失败');
  } finally {
    isLoadingList.value = false;
  }
}

/** 点击搜索（回到第一页） */
function handleSearch() {
  filters.page = 1;
  void loadSubmissions();
}

/** 重置筛选条件 */
function handleResetFilters() {
  filters.keyword = '';
  filters.startDate = '';
  filters.endDate = '';
  filters.page = 1;
  void loadSubmissions();
}

/** 导出当前筛选条件下的汇总 CSV */
async function handleExportCsv() {
  isExporting.value = true;
  try {
    const url = getAdminExportCsvUrl({
      keyword: filters.keyword,
      start_date: filters.startDate,
      end_date: filters.endDate,
    });
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) {
      isAuthenticated.value = false;
      ElMessage.warning('登录已过期，请重新登录');
      return;
    }
    if (!res.ok) {
      ElMessage.error('导出失败，请稍后重试');
      return;
    }
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `orders-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    ElMessage.success('汇总表格导出成功');
  } catch {
    ElMessage.error('网络异常，导出失败');
  } finally {
    isExporting.value = false;
  }
}

/** 打开详情抽屉 */
function openDetail(item: SubmissionItem) {
  activeItem.value = item;
  detailVisible.value = true;
}

/** 判断附件是否为 PDF */
function isPdfMeta(meta: SubmissionFileMeta): boolean {
  return meta.mime_type === 'application/pdf';
}

/** 获取一条记录下所有可全屏轮播预览的图片附件 URL 列表 */
function getItemImageFiles(item: SubmissionItem): SubmissionFileMeta[] {
  const candidates = [
    item.files.order_screenshot,
    item.files.review_screenshot,
    item.files.wechat_qr_code,
    item.files.invoice_file,
  ];
  return candidates.filter((f) => !isPdfMeta(f));
}

/** 点击预览某一个附件（图片打开全屏灯箱，PDF 在新标签页打开预览） */
function previewFile(item: SubmissionItem, file: SubmissionFileMeta) {
  if (isPdfMeta(file)) {
    window.open(getAdminFileUrl(file.id, false), '_blank', 'noopener,noreferrer');
    return;
  }
  const imageFiles = getItemImageFiles(item);
  const idx = imageFiles.findIndex((f) => f.id === file.id);
  viewerUrls.value = imageFiles.map((f) => getAdminFileUrl(f.id, false));
  viewerIndex.value = idx >= 0 ? idx : 0;
  viewerVisible.value = true;
}

/** 触发单个文件下载 */
function downloadFile(file: SubmissionFileMeta) {
  const link = document.createElement('a');
  link.href = getAdminFileUrl(file.id, true);
  link.download = file.file_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** 复制文本到剪贴板 */
async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`已复制${label}`);
  } catch {
    ElMessage.info(`${label}：${text}`);
  }
}

/** 删除指定订单记录 */
async function handleDelete(item: SubmissionItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除订单号「${item.order_no}」（微信名：${item.wechat_name}）及其全部 4 个附件文件吗？删除后无法恢复。`,
      '确认删除',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }

  try {
    await deleteAdminSubmission(item.id);
    ElMessage.success('删除成功');
    if (activeItem.value?.id === item.id) {
      detailVisible.value = false;
      activeItem.value = null;
    }
    if (items.value.length === 1 && filters.page > 1) {
      filters.page -= 1;
    }
    await loadSubmissions();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败');
  }
}

/** 4 个附件的展示元数据列表 */
const attachmentDescriptors = [
  { key: 'order_screenshot', label: '订单截图' },
  { key: 'review_screenshot', label: '评价截图' },
  { key: 'wechat_qr_code', label: '微信收款码' },
  { key: 'invoice_file', label: '发票文件' },
] as const;

onMounted(() => {
  updateViewportFlag();
  window.addEventListener('resize', updateViewportFlag);
  void checkAuth();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportFlag);
});
</script>

<template>
  <div class="admin-shell">
    <!-- 鉴权加载中占位 -->
    <div v-if="isCheckingAuth" class="center-box">
      <el-card class="login-card">
        <el-skeleton :rows="4" animated />
      </el-card>
    </div>

    <!-- 未登录：显示管理员登录卡片 -->
    <div v-else-if="!isAuthenticated" class="center-box">
      <div class="login-card">
        <div class="login-icon">
          <el-icon :size="28"><Lock /></el-icon>
        </div>
        <h1 class="login-title">订单汇总管理后台</h1>
        <p class="login-subtitle">请输入管理员密码以查阅和导出用户上传的订单凭证</p>

        <el-form @submit.prevent="handleLogin">
          <el-form-item>
            <el-input
              v-model="loginPassword"
              type="password"
              size="large"
              show-password
              placeholder="请输入管理员密码"
              :prefix-icon="Lock"
              autofocus
            />
          </el-form-item>
          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="isLoggingIn"
            native-type="submit"
          >
            登录后台
          </el-button>
        </el-form>

        <div class="login-footer">
          <router-link to="/" class="back-home-link">← 返回前台上传页面</router-link>
        </div>
      </div>
    </div>

    <!-- 已登录：完整后台汇总管理界面 -->
    <div v-else class="dashboard-container">
      <!-- 顶部导航栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="topbar-title">订单凭证汇总管理后台</h1>
          <span class="topbar-sub">Cloudflare Workers + D1 实时汇总</span>
        </div>
        <div class="topbar-actions">
          <el-button
            type="success"
            plain
            :icon="Download"
            :loading="isExporting"
            @click="handleExportCsv"
          >
            导出 CSV
          </el-button>
          <el-button :icon="Refresh" :loading="isLoadingList" @click="loadSubmissions">
            刷新
          </el-button>
          <router-link to="/" class="topbar-link-btn">
            <el-button plain>前台上传页</el-button>
          </router-link>
          <el-button type="danger" plain :icon="SwitchButton" @click="handleLogout">
            退出
          </el-button>
        </div>
      </header>

      <!-- 汇总统计卡片区（桌面 4 列 / 手机 2×2） -->
      <section class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">符合条件订单数</div>
          <div class="stat-value">{{ summary.total_count }} <span class="stat-unit">笔</span></div>
        </div>
        <div class="stat-card stat-card-blue">
          <div class="stat-label">订单总金额</div>
          <div class="stat-value mono">¥{{ formatCurrencyDisplay(summary.total_order_amount) }}</div>
        </div>
        <div class="stat-card stat-card-teal">
          <div class="stat-label">不含税总金额</div>
          <div class="stat-value mono">
            ¥{{ formatCurrencyDisplay(summary.total_excl_tax_amount) }}
          </div>
        </div>
        <div class="stat-card stat-card-indigo">
          <div class="stat-label">今日新增提交</div>
          <div class="stat-value">{{ summary.today_count }} <span class="stat-unit">笔</span></div>
        </div>
      </section>

      <!-- 筛选搜索栏 -->
      <section class="panel-card filter-panel">
        <div class="filter-row">
          <el-input
            v-model="filters.keyword"
            placeholder="搜索订单号或微信名..."
            clearable
            :prefix-icon="Search"
            class="filter-keyword"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <el-date-picker
            v-model="filters.startDate"
            type="date"
            placeholder="下单开始日期"
            value-format="YYYY-MM-DD"
            clearable
            class="filter-date"
          />
          <el-date-picker
            v-model="filters.endDate"
            type="date"
            placeholder="下单结束日期"
            value-format="YYYY-MM-DD"
            clearable
            class="filter-date"
          />
          <div class="filter-btns">
            <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
            <el-button @click="handleResetFilters">重置</el-button>
          </div>
        </div>
      </section>

      <!-- 数据展示面板：桌面端表格 + 手机端卡片 -->
      <section class="panel-card list-panel" v-loading="isLoadingList">
        <!-- 桌面端表格 -->
        <el-table v-if="!isMobile" :data="items" stripe border style="width: 100%" empty-text="暂无匹配的订单记录">
          <el-table-column prop="order_time" label="下单时间" min-width="160" />
          <el-table-column label="订单号" min-width="175">
            <template #default="{ row }">
              <div class="cell-with-copy">
                <span class="mono cell-ellipsis" :title="row.order_no">{{ row.order_no }}</span>
                <el-button
                  text
                  size="small"
                  :icon="CopyDocument"
                  title="复制订单号"
                  @click="copyText('订单号', row.order_no)"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="wechat_name" label="下单用户-微信名" min-width="135" show-overflow-tooltip />
          <el-table-column label="订单金额" min-width="115" align="right">
            <template #default="{ row }">
              <span class="mono amount-text">¥{{ row.order_amount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="不含税金额" min-width="115" align="right">
            <template #default="{ row }">
              <span class="mono">¥{{ row.amount_excl_tax }}</span>
            </template>
          </el-table-column>
          <el-table-column label="凭证附件（点击预览）" min-width="235">
            <template #default="{ row }">
              <div class="attachment-tags">
                <el-button
                  v-for="desc in attachmentDescriptors"
                  :key="desc.key"
                  size="small"
                  plain
                  type="primary"
                  @click="previewFile(row, row.files[desc.key])"
                >
                  {{ desc.key === 'wechat_qr_code' ? '收款码' : desc.label.replace('截图', '').replace('文件', '') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" min-width="160">
            <template #default="{ row }">
              {{ formatIsoToBeijingTime(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
              <el-button link type="danger" :icon="Delete" @click="handleDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 移动端卡片列表 -->
        <div v-else class="mobile-cards">
          <el-empty v-if="items.length === 0" description="暂无匹配的订单记录" />
          <div v-for="item in items" :key="item.id" class="mobile-order-card">
            <div class="m-card-head">
              <div>
                <div class="m-order-no mono">{{ item.order_no }}</div>
                <div class="m-wechat">微信用户：{{ item.wechat_name }}</div>
              </div>
              <el-tag size="small" type="info">{{ item.order_time }}</el-tag>
            </div>

            <div class="m-amounts-row">
              <div class="m-amount-box">
                <span class="m-amount-label">订单金额</span>
                <span class="m-amount-val mono">¥{{ item.order_amount }}</span>
              </div>
              <div class="m-amount-box">
                <span class="m-amount-label">不含税金额</span>
                <span class="m-amount-val mono">¥{{ item.amount_excl_tax }}</span>
              </div>
            </div>

            <div class="m-attachments">
              <el-button
                v-for="desc in attachmentDescriptors"
                :key="desc.key"
                size="small"
                plain
                type="primary"
                @click="previewFile(item, item.files[desc.key])"
              >
                {{ desc.label }}
              </el-button>
            </div>

            <div class="m-card-foot">
              <span class="m-time">提交：{{ formatIsoToBeijingTime(item.created_at) }}</span>
              <div class="m-ops">
                <el-button size="small" type="primary" plain @click="openDetail(item)">
                  详情
                </el-button>
                <el-button size="small" type="danger" plain @click="handleDelete(item)">
                  删除
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 分页控件 -->
        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="filters.page"
            v-model:page-size="filters.pageSize"
            :total="total"
            :page-sizes="[15, 30, 50, 100]"
            :layout="isMobile ? 'prev, pager, next, total' : 'total, sizes, prev, pager, next'"
            :size="isMobile ? 'small' : 'default'"
            @current-change="loadSubmissions"
            @size-change="handleSearch"
          />
        </div>
      </section>
    </div>

    <!-- 订单详情与附件高清预览抽屉 -->
    <el-drawer
      v-model="detailVisible"
      title="订单完整信息与凭证详情"
      :size="drawerSize"
      destroy-on-close
    >
      <template v-if="activeItem">
        <el-descriptions :column="1" border class="detail-descriptions">
          <el-descriptions-item label="下单时间">{{ activeItem.order_time }}</el-descriptions-item>
          <el-descriptions-item label="订单号">
            <div class="cell-with-copy">
              <span class="mono">{{ activeItem.order_no }}</span>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                @click="copyText('订单号', activeItem.order_no)"
              >
                复制
              </el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="下单用户-微信名">
            <div class="cell-with-copy">
              <span>{{ activeItem.wechat_name }}</span>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                @click="copyText('微信名', activeItem.wechat_name)"
              >
                复制
              </el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="订单金额">
            <span class="mono amount-text">¥{{ activeItem.order_amount }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="不含税金额">
            <span class="mono">¥{{ activeItem.amount_excl_tax }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ formatIsoToBeijingTime(activeItem.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="系统记录 ID">
            <span class="mono id-text">{{ activeItem.id }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <h3 class="detail-section-title">上传凭证与附件</h3>
        <div class="detail-files-grid">
          <div
            v-for="desc in attachmentDescriptors"
            :key="desc.key"
            class="detail-file-card"
          >
            <div class="detail-file-header">
              <span class="detail-file-title">{{ desc.label }}</span>
              <span class="detail-file-size">
                {{ formatFileSize(activeItem.files[desc.key].file_size) }}
              </span>
            </div>

            <div
              class="detail-file-preview"
              @click="previewFile(activeItem, activeItem.files[desc.key])"
            >
              <img
                v-if="!isPdfMeta(activeItem.files[desc.key])"
                :src="getAdminFileUrl(activeItem.files[desc.key].id)"
                :alt="desc.label"
                loading="lazy"
                class="detail-thumb-img"
              />
              <div v-else class="detail-pdf-box">
                <el-icon :size="36" color="#dc2626"><Document /></el-icon>
                <span>点击新窗口预览 PDF</span>
              </div>
            </div>

            <div class="detail-file-actions">
              <el-button
                size="small"
                type="primary"
                plain
                :icon="Picture"
                @click="previewFile(activeItem, activeItem.files[desc.key])"
              >
                {{ isPdfMeta(activeItem.files[desc.key]) ? '预览 PDF' : '放大查看' }}
              </el-button>
              <el-button
                size="small"
                :icon="Download"
                @click="downloadFile(activeItem.files[desc.key])"
              >
                下载
              </el-button>
            </div>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 全屏图片灯箱预览器 -->
    <el-image-viewer
      v-if="viewerVisible"
      :url-list="viewerUrls"
      :initial-index="viewerIndex"
      teleported
      @close="viewerVisible = false"
    />
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background-color: #f1f5f9;
}

.center-box {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border-radius: 16px;
  padding: 32px 28px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.12);
  text-align: center;
}

.login-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 14px;
  background: #eff6ff;
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.login-subtitle {
  margin: 8px 0 22px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.login-btn {
  width: 100%;
  margin-top: 6px;
}

.login-footer {
  margin-top: 18px;
}

.back-home-link {
  font-size: 13px;
  color: #2563eb;
  text-decoration: none;
}

.dashboard-container {
  max-width: 1320px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.topbar {
  background: #ffffff;
  border-radius: 14px;
  padding: 16px 20px;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.topbar-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: #0f172a;
}

.topbar-sub {
  display: inline-block;
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.topbar-link-btn {
  text-decoration: none;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.stat-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 16px 18px;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #64748b;
}

.stat-card-blue {
  border-left-color: #2563eb;
}

.stat-card-teal {
  border-left-color: #0d9488;
}

.stat-card-indigo {
  border-left-color: #6366f1;
}

.stat-label {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 6px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  word-break: break-all;
}

.stat-unit {
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
}

.panel-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 16px;
  border: 1px solid #e2e8f0;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-keyword {
  width: 240px;
}

.filter-date {
  width: 165px !important;
}

.filter-btns {
  display: flex;
  gap: 8px;
}

.cell-with-copy {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cell-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount-text {
  color: #1d4ed8;
  font-weight: 600;
}

.attachment-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.attachment-tags :deep(.el-button + .el-button) {
  margin-left: 0;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* 移动端卡片列表样式 */
.mobile-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-order-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.m-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.m-order-no {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  word-break: break-all;
}

.m-wechat {
  font-size: 13px;
  color: #475569;
  margin-top: 2px;
}

.m-amounts-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  background: #ffffff;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.m-amount-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.m-amount-label {
  font-size: 11px;
  color: #64748b;
}

.m-amount-val {
  font-size: 15px;
  font-weight: 700;
  color: #1d4ed8;
}

.m-attachments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.m-attachments :deep(.el-button + .el-button) {
  margin-left: 0;
}

.m-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid #e2e8f0;
}

.m-time {
  font-size: 11px;
  color: #64748b;
}

.m-ops {
  display: flex;
  gap: 6px;
}

/* 详情抽屉样式 */
.detail-section-title {
  margin: 22px 0 12px;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.id-text {
  font-size: 12px;
  color: #64748b;
  word-break: break-all;
}

.detail-files-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.detail-file-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.detail-file-title {
  font-weight: 600;
  color: #1e293b;
}

.detail-file-size {
  font-size: 11px;
  color: #64748b;
}

.detail-file-preview {
  height: 150px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-pdf-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.detail-file-actions {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.detail-file-actions :deep(.el-button) {
  flex: 1;
}

.detail-file-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .dashboard-container {
    padding: 12px 10px 32px;
  }

  .topbar {
    padding: 14px;
  }

  .topbar-actions {
    width: 100%;
  }

  .stat-value {
    font-size: 18px;
  }

  .filter-keyword,
  .filter-date {
    width: 100% !important;
  }

  .filter-btns {
    width: 100%;
  }

  .filter-btns :deep(.el-button) {
    flex: 1;
  }

  .pagination-wrap {
    justify-content: center;
  }

  .detail-files-grid {
    grid-template-columns: 1fr;
  }
}
</style>
