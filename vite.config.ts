/**
 * ============================================================================
 * Vite 构建与本地开发服务器配置
 * ============================================================================
 */

import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 本地同时运行 `npm run dev:web` 与 `npm run dev:worker` 时，将 /api 请求代理至 Wrangler
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 将 Vue 核心库与 Element Plus 独立拆包，提升浏览器缓存命中率
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router'],
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
  },
});
