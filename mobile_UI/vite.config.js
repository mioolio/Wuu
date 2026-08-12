import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 移动端 UI 构建配置
// 产物输出到 dist/, 由桌面端 HTTP 服务器 (server/index.js) 静态托管
// base: './' 使用相对路径, 确保在任何端口/路径下都能正确加载资源
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5174,
    // 开发时将 API 请求代理到桌面端服务器 (默认 30967)
    proxy: {
      '/api': 'http://127.0.0.1:30967',
      '/ping': 'http://127.0.0.1:30967',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
