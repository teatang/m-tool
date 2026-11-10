<script setup lang="ts">
/**
 * ============================================================================
 * 通用图片 / 发票文件上传卡片组件
 * 功能特性：
 * 1. 支持点击选择文件（手机端可调起相册/拍照/文件管理器）与桌面端拖拽上传；
 * 2. 自动对超大图片进行等比压缩（微信收款码自动启用高清晰度模式），提升移动端上传体验；
 * 3. 支持图片即时缩略图预览放大与 PDF 文件标识展示。
 * ============================================================================
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Delete, Document, Picture, RefreshRight, UploadFilled, ZoomIn } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { formatFileSize } from '@/utils/format';
import { compressImageFile } from '@/utils/imageCompress';

interface Props {
  /** 当前绑定的文件对象 */
  modelValue: File | null;
  /** 上传卡片标题 */
  label: string;
  /** 格式或清晰度说明文案 */
  hint?: string;
  /** 是否允许上传 PDF 文件（发票字段开启） */
  allowPdf?: boolean;
  /** 是否为高清晰度模式（用于微信收款码，避免过度压缩影响扫码） */
  highDetail?: boolean;
  /** 是否处于必填校验错误状态 */
  hasError?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  hint: '支持 JPG / PNG / WebP 图片',
  allowPdf: false,
  highDetail: false,
  hasError: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: File | null): void;
  (e: 'change', value: File | null): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const isProcessing = ref(false);
const previewUrl = ref('');
const compressNote = ref('');

/** 计算原生 input accept 属性 */
const acceptAttr = computed(() =>
  props.allowPdf
    ? 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf'
    : 'image/jpeg,image/png,image/webp,image/gif',
);

/** 判断当前选中文件是否为 PDF */
const isPdfFile = computed(() => {
  if (!props.modelValue) return false;
  return (
    props.modelValue.type === 'application/pdf' ||
    props.modelValue.name.toLowerCase().endsWith('.pdf')
  );
});

/** 清理旧的 ObjectURL 避免内存泄漏 */
function revokePreviewUrl() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

watch(
  () => props.modelValue,
  (nextFile) => {
    revokePreviewUrl();
    if (!nextFile) {
      compressNote.value = '';
      return;
    }
    if (!isPdfFile.value) {
      previewUrl.value = URL.createObjectURL(nextFile);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  revokePreviewUrl();
});

/** 触发隐藏文件选择器 */
function triggerPick() {
  if (isProcessing.value) return;
  fileInputRef.value?.click();
}

/** 清空已选文件 */
function clearFile() {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
  compressNote.value = '';
  emit('update:modelValue', null);
  emit('change', null);
}

/** 校验并处理用户选中的文件 */
async function handleSelectedFile(rawFile: File | undefined) {
  if (!rawFile) return;

  const isPdf =
    rawFile.type === 'application/pdf' || rawFile.name.toLowerCase().endsWith('.pdf');
  const isImage = rawFile.type.startsWith('image/');

  if (isPdf && !props.allowPdf) {
    ElMessage.warning(`${props.label}仅支持上传图片格式（JPG/PNG/WebP/GIF）`);
    return;
  }

  if (!isImage && !isPdf) {
    ElMessage.warning(
      props.allowPdf
        ? `${props.label}仅支持图片或 PDF 文件`
        : `${props.label}仅支持 JPG / PNG / WebP / GIF 图片`,
    );
    return;
  }

  // PDF 文件不可在前端无损压缩，需直接校验体积上限（1.2MB）
  const maxPdfBytes = Math.floor(1.2 * 1024 * 1024);
  if (isPdf && rawFile.size > maxPdfBytes) {
    ElMessage.error(
      `PDF 文件大小不能超过 1.2MB（当前 ${formatFileSize(rawFile.size)}），建议先压缩 PDF 或转为清晰图片上传`,
    );
    return;
  }

  // 单张原始图片限制在 20MB 内防止移动端浏览器解码内存溢出
  if (isImage && rawFile.size > 20 * 1024 * 1024) {
    ElMessage.error('单张图片原图不能超过 20MB');
    return;
  }

  isProcessing.value = true;
  try {
    const result = await compressImageFile(rawFile, {
      maxDimension: props.highDetail ? 1050 : 1400,
      quality: props.highDetail ? 0.9 : 0.82,
    });

    const maxImageBytes = 1 * 1024 * 1024;
    if (!isPdf && result.file.size > maxImageBytes) {
      // 若首次压缩后仍大于 1MB，进行一次二次轻量降维压缩
      const retry = await compressImageFile(rawFile, {
        maxDimension: 1000,
        quality: 0.72,
      });
      if (retry.file.size > maxImageBytes) {
        ElMessage.error(`${props.label}压缩后仍超过 1MB，请换一张分辨率更低的图片`);
        return;
      }
      compressNote.value = `已压缩 ${formatFileSize(retry.originalSize)} → ${formatFileSize(retry.compressedSize)}`;
      emit('update:modelValue', retry.file);
      emit('change', retry.file);
      return;
    }

    if (result.wasCompressed) {
      compressNote.value = `已自动优化 ${formatFileSize(result.originalSize)} → ${formatFileSize(result.compressedSize)}`;
    } else {
      compressNote.value = `大小 ${formatFileSize(result.compressedSize)}`;
    }

    emit('update:modelValue', result.file);
    emit('change', result.file);
  } finally {
    isProcessing.value = false;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  }
}

function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  void handleSelectedFile(file);
}

function onDrop(event: DragEvent) {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  void handleSelectedFile(file);
}
</script>

<template>
  <div
    class="upload-card"
    :class="{
      'is-dragging': isDragging,
      'is-filled': Boolean(modelValue),
      'is-error': hasError && !modelValue,
    }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="fileInputRef"
      class="sr-only-input"
      type="file"
      :accept="acceptAttr"
      @change="onInputChange"
    />

    <!-- 未选择文件状态：显示直观上传引导区域 -->
    <button
      v-if="!modelValue"
      type="button"
      class="upload-placeholder"
      :disabled="isProcessing"
      @click="triggerPick"
    >
      <div class="upload-icon-wrap">
        <el-icon :size="26">
          <UploadFilled />
        </el-icon>
      </div>
      <div class="upload-title">{{ isProcessing ? '正在优化处理...' : `点击上传${label}` }}</div>
      <div class="upload-hint">{{ hint }}</div>
    </button>

    <!-- 已选择文件状态：显示预览与快捷操作按钮 -->
    <div v-else class="upload-preview-wrap">
      <div class="preview-media">
        <el-image
          v-if="!isPdfFile && previewUrl"
          :src="previewUrl"
          :preview-src-list="[previewUrl]"
          fit="cover"
          preview-teleported
          class="preview-thumb"
        >
          <template #error>
            <div class="thumb-fallback">
              <el-icon :size="24"><Picture /></el-icon>
            </div>
          </template>
        </el-image>
        <div v-else class="pdf-badge">
          <el-icon :size="28" color="#dc2626"><Document /></el-icon>
          <span>PDF</span>
        </div>
      </div>

      <div class="preview-info">
        <div class="file-name" :title="modelValue.name">{{ modelValue.name }}</div>
        <div class="file-meta">
          <el-tag size="small" type="success" effect="light">
            {{ compressNote || formatFileSize(modelValue.size) }}
          </el-tag>
        </div>
        <div class="preview-actions">
          <el-button
            v-if="!isPdfFile && previewUrl"
            size="small"
            text
            type="primary"
            :icon="ZoomIn"
            @click="() => {}"
            class="hint-preview-btn"
          >
            点击左侧缩略图可放大
          </el-button>
          <div class="action-buttons">
            <el-button size="small" :icon="RefreshRight" @click="triggerPick">重选</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="clearFile">
              移除
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-card {
  position: relative;
  width: 100%;
  min-height: 136px;
  border: 1.5px dashed #cbd5e1;
  border-radius: 12px;
  background-color: #f8fafc;
  transition: all 0.2s ease;
  overflow: hidden;
}

.upload-card:hover {
  border-color: #3b82f6;
  background-color: #f0f7ff;
}

.upload-card.is-dragging {
  border-color: #2563eb;
  background-color: #eff6ff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.upload-card.is-filled {
  border-style: solid;
  border-color: #bfdbfe;
  background-color: #ffffff;
}

.upload-card.is-error {
  border-color: #f56c6c;
  background-color: #fef2f2;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.upload-placeholder {
  width: 100%;
  min-height: 134px;
  padding: 16px 12px;
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  color: inherit;
  text-align: center;
}

.upload-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #e0edff;
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.upload-hint {
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.upload-preview-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  min-height: 134px;
}

.preview-media {
  flex-shrink: 0;
  width: 88px;
  height: 88px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-thumb {
  width: 100%;
  height: 100%;
  cursor: zoom-in;
}

.thumb-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}

.pdf-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #dc2626;
}

.preview-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.preview-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.hint-preview-btn {
  padding: 0;
  height: auto;
  justify-content: flex-start;
  font-size: 12px;
  cursor: default;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 480px) {
  .preview-media {
    width: 76px;
    height: 76px;
  }

  .hint-preview-btn {
    display: none;
  }
}
</style>
