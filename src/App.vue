<script setup lang="ts">
/**
 * ============================================================================
 * 根组件 (App.vue)
 * 说明：注入 Element Plus 简体中文语言包，统一渲染路由视图
 * ============================================================================
 */

import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>
