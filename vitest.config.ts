/**
 * ============================================================================
 * Vitest 单元测试配置
 * 说明：统一执行后端 Workers/D1 接口单元测试与前端工具/组件单元测试
 * ============================================================================
 */

import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // 默认使用 node 环境执行后端与纯函数测试，前端组件测试通过文件顶部 @vitest-environment happy-dom 声明
    environment: 'node',
  },
});
