/**
 * ============================================================================
 * 前端应用主入口文件
 * ============================================================================
 */

import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import './styles/main.css';

const app = createApp(App);
app.use(ElementPlus);
app.use(router);
app.mount('#app');
