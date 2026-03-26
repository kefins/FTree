import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'path';
import { registerIPCHandlers } from './ipc-handlers';
import { startServer } from './express-server';
import { DEFAULT_PORT } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'FTree 家谱管理',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // 开发模式：加载 Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式：加载打包后的前端文件
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildChineseMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 应用菜单
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: '关于 FTree', role: 'about' as const },
              { type: 'separator' as const },
              { label: '偏好设置', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send('navigate', '/settings') },
              { type: 'separator' as const },
              { label: '隐藏 FTree', role: 'hide' as const },
              { label: '隐藏其他', role: 'hideOthers' as const },
              { label: '全部显示', role: 'unhide' as const },
              { type: 'separator' as const },
              { label: '退出 FTree', role: 'quit' as const },
            ],
          },
        ]
      : []),

    // 文件
    {
      label: '文件',
      submenu: [
        ...(isMac
          ? [{ label: '关闭窗口', role: 'close' as const }]
          : [{ label: '退出', role: 'quit' as const }]),
      ],
    },

    // 编辑
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' as const, accelerator: 'CmdOrCtrl+Z' },
        { label: '重做', role: 'redo' as const, accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y' },
        { type: 'separator' as const },
        { label: '剪切', role: 'cut' as const, accelerator: 'CmdOrCtrl+X' },
        { label: '复制', role: 'copy' as const, accelerator: 'CmdOrCtrl+C' },
        { label: '粘贴', role: 'paste' as const, accelerator: 'CmdOrCtrl+V' },
        { label: '全选', role: 'selectAll' as const, accelerator: 'CmdOrCtrl+A' },
      ],
    },

    // 视图
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' as const, accelerator: 'CmdOrCtrl+R' },
        { label: '强制重新加载', role: 'forceReload' as const, accelerator: 'CmdOrCtrl+Shift+R' },
        { label: '开发者工具', role: 'toggleDevTools' as const, accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I' },
        { type: 'separator' as const },
        { label: '实际大小', role: 'resetZoom' as const, accelerator: 'CmdOrCtrl+0' },
        { label: '放大', role: 'zoomIn' as const, accelerator: 'CmdOrCtrl+=' },
        { label: '缩小', role: 'zoomOut' as const, accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' as const },
        { label: '全屏', role: 'togglefullscreen' as const, accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11' },
      ],
    },

    // 窗口
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { label: '前置窗口', role: 'front' as const },
            ]
          : [{ label: '关闭', role: 'close' as const }]),
      ],
    },

    // 帮助
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 FTree',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox({
              type: 'info',
              title: '关于 FTree',
              message: 'FTree 家谱管理系统',
              detail: `版本：${app.getVersion()}\n\n一款用于管理和展示家族谱系的桌面应用。`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 应用生命周期管理
app.whenReady().then(async () => {
  // 注册 IPC handlers
  registerIPCHandlers();

  // 设置中文菜单
  buildChineseMenu();

  // 启动 Express 服务（Electron 模式下也启动，保持 HTTP API 可用）
  try {
    const port = await startServer(DEFAULT_PORT);
    console.log(`Express server started on port ${port}`);
  } catch (err) {
    console.error('Failed to start Express server:', err);
  }

  // 创建主窗口
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
