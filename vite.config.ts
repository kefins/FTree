import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron' || process.env.ELECTRON === 'true';

  const plugins: any[] = [react()];

  if (isElectron) {
    plugins.push(
      electron([
        {
          // Electron 主进程入口
          entry: 'src/main/index.ts',
          vite: {
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: ['electron', 'express', 'uuid'],
              },
            },
          },
        },
        {
          // Preload 脚本
          entry: 'src/main/preload.ts',
          onstart(args) {
            // preload 构建完成后通知渲染进程重新加载
            args.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      // 使渲染进程可以使用 Node.js API（通过 preload）
      electronRenderer(),
    );
  }

  return {
    plugins,
    // Electron 生产模式使用 file:// 协议，资源路径必须为相对路径
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    // root 使用默认（项目根目录），index.html 在根目录
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      host: true,
    },
  };
});
