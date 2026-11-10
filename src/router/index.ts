/**
 * ============================================================================
 * 前端路由配置模块 (Vue Router)
 * 路由说明：
 * - `/`      前台唯一页面：订单信息与凭证上传表单
 * - `/admin` 后台管理页面：管理员登录与订单汇总查阅
 * ============================================================================
 */

import { createRouter, createWebHistory } from 'vue-router';
import UploadView from '@/views/UploadView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'upload',
      component: UploadView,
      meta: { title: '订单凭证信息上传' },
    },
    {
      path: '/admin',
      name: 'admin',
      // 懒加载后台管理页面，减小前台手机端首屏加载体积
      component: () => import('@/views/AdminView.vue'),
      meta: { title: '订单汇总管理后台' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

router.afterEach((to) => {
  if (typeof document !== 'undefined' && typeof to.meta.title === 'string') {
    document.title = to.meta.title;
  }
});

export default router;
