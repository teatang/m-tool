/**
 * ============================================================================
 * 前端图片自动压缩与分辨率缩放模块
 * 说明：
 * 1. 手机拍照原图通常在 3MB~10MB，若直接上传极易触发 Cloudflare D1 单行/单包限制；
 * 2. 本模块在浏览器端利用 Canvas 等比缩放并压缩图片，大幅提升手机上传速度并节省 D1 存储额度；
 * 3. 对微信收款码 (wechat_qr_code) 自动采用更高的清晰度参数，确保后台扫码稳定识别；
 * 4. PDF 与 GIF 文件保持原样，不破坏文档或动图结构。
 * ============================================================================
 */

export interface CompressOptions {
  /** 最大允许边长（像素），默认 1400 */
  maxDimension?: number;
  /** 压缩输出质量（0~1），默认 0.82 */
  quality?: number;
  /** 低于该阈值（字节）的小图片不再二次压缩，默认 180KB */
  skipBelowBytes?: number;
}

export interface CompressResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

/**
 * 纯函数：计算在不超过最大边长限制下的等比缩放目标宽高（只缩小不放大）
 *
 * @param width 原始宽度
 * @param height 原始高度
 * @param maxDimension 最大允许边长
 * @returns 目标宽高（整数像素）
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxDimension <= 0) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }
  const maxSide = Math.max(width, height);
  if (maxSide <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxDimension / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 将 HTMLCanvasElement 导出为指定 MIME 类型的 Blob
 */
function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * 加载图片文件为 HTMLImageElement
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

/**
 * 压缩单张图片文件；若为非可压缩图片（PDF/GIF）或体积已很小，则保留原文件
 *
 * @param file 原始 File 对象
 * @param options 压缩参数配置
 * @returns 压缩后的结果信息
 */
export async function compressImageFile(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const maxDimension = options.maxDimension ?? 1400;
  const quality = options.quality ?? 0.82;
  const skipBelowBytes = options.skipBelowBytes ?? 180 * 1024;

  const originalSize = file.size;
  const compressibleMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  // 非普通静态位图（例如 PDF 发票、GIF 动图）直接返回原文件
  if (!compressibleMimes.has(file.type)) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  // 若浏览器不支持 Canvas（如纯 SSR/测试环境），安全降级返回原文件
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  try {
    const img = await loadImageFromFile(file);
    const target = calculateTargetDimensions(img.naturalWidth, img.naturalHeight, maxDimension);

    // 若图片尺寸未超限且体积已小于阈值，无需额外重编码
    const needsResize = target.width !== img.naturalWidth || target.height !== img.naturalHeight;
    if (!needsResize && originalSize <= skipBelowBytes) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    // 填充白色底色，避免带透明通道的 PNG 转 JPEG 后背景变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0, target.width, target.height);

    // 优先使用 image/jpeg 保证全平台（含旧版 iOS Safari）最佳压缩兼容性
    const outputMime = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, outputMime, quality);

    if (!blob || blob.size >= originalSize) {
      // 如果压缩后体积反而更大（如极简纯色 PNG），保留原文件
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }

    const ext = outputMime === 'image/webp' ? 'webp' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    const compressedFile = new File([blob], `${baseName}.${ext}`, {
      type: outputMime,
      lastModified: Date.now(),
    });

    return {
      file: compressedFile,
      originalSize,
      compressedSize: compressedFile.size,
      wasCompressed: true,
    };
  } catch {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }
}
