import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import {
  isInitialized,
  isLoggedIn,
  setupPassword,
  initialize,
  createPerson,
  updatePerson,
  deletePerson,
  getPerson,
  listPersons,
  getTreeData,
  getChildren,
  reorderChildren,
  exportData,
  importData,
  backup,
  clearAllData,
  getGenerationChars,
  saveGenerationChars,
} from './data-service';
import {
  getConfiguredDataPath,
  getDefaultDataDir,
  changeDataDir,
  resetDataDir,
} from './file-manager';

/** 注册所有 IPC handlers */
export function registerIPCHandlers(): void {
  // ==================== 认证 ====================

  ipcMain.handle('auth:check', async () => {
    try {
      return { initialized: isInitialized(), loggedIn: isLoggedIn() };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:setup', async (_event, password: string) => {
    try {
      setupPassword(password);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:login', async (_event, password: string) => {
    try {
      return initialize(password);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  // ==================== 人员管理 ====================

  ipcMain.handle('person:create', async (_event, data) => {
    try {
      return createPerson(data);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('person:update', async (_event, id: string, data) => {
    try {
      return updatePerson(id, data);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('person:delete', async (_event, id: string) => {
    try {
      deletePerson(id);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('person:get', async (_event, id: string) => {
    try {
      const person = getPerson(id);
      if (!person) throw new Error('人员不存在');
      return person;
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('person:list', async (_event, query?) => {
    try {
      return listPersons(query);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  // ==================== 树数据 ====================

  ipcMain.handle('tree:getData', async () => {
    try {
      return getTreeData();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('tree:getChildren', async (_event, parentId: string) => {
    try {
      return getChildren(parentId);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('tree:reorderChildren', async (_event, parentId: string, orderedIds: string[]) => {
    try {
      reorderChildren(parentId, orderedIds);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  // ==================== 数据导入导出 ====================

  ipcMain.handle('data:export', async () => {
    try {
      return exportData();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('data:import', async (_event, data) => {
    try {
      importData(data);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('data:backup', async () => {
    try {
      return backup();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('data:clear', async () => {
    try {
      clearAllData();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  // ==================== 辈分字管理 ====================

  ipcMain.handle('config:getGenerationChars', async () => {
    try {
      return getGenerationChars();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('config:saveGenerationChars', async (_event, data: { poem?: string; characters: Record<number, string> }) => {
    try {
      saveGenerationChars(data);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  // ==================== 导出图片 ====================

  ipcMain.handle(
    'export:saveImage',
    async (_event, bufferOrBase64: ArrayBuffer | string, filename: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) throw new Error('无法获取窗口');

        const result = await dialog.showSaveDialog(win, {
          title: '保存家谱图片',
          defaultPath: filename || `家谱_${Date.now()}.png`,
          filters: [
            { name: 'PNG 图片', extensions: ['png'] },
            { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return '';
        }

        // 处理两种情况：base64 data URL 字符串（来自渲染进程 bridge）或纯 ArrayBuffer
        let fileBuffer: Buffer;
        if (typeof bufferOrBase64 === 'string') {
          // 移除 data URL 前缀 "data:image/png;base64,"
          const base64Data = bufferOrBase64.replace(/^data:image\/\w+;base64,/, '');
          fileBuffer = Buffer.from(base64Data, 'base64');
        } else {
          fileBuffer = Buffer.from(bufferOrBase64);
        }

        fs.writeFileSync(result.filePath, fileBuffer);
        return result.filePath;
      } catch (e: any) {
        throw new Error(e.message);
      }
    }
  );

  // ==================== 数据路径管理 ====================

  ipcMain.handle('config:getDataPath', async () => {
    try {
      return {
        current: getConfiguredDataPath(),
        default: getDefaultDataDir(),
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('config:selectDataPath', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) throw new Error('无法获取窗口');

      const result = await dialog.showOpenDialog(win, {
        title: '选择数据存储目录',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '选择此目录',
      });

      if (result.canceled || !result.filePaths.length) {
        return null;
      }
      return result.filePaths[0];
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle(
    'config:setDataPath',
    async (_event, newPath: string, migrate: boolean) => {
      try {
        const resultPath = changeDataDir(newPath, migrate);
        return resultPath;
      } catch (e: any) {
        throw new Error(e.message);
      }
    }
  );

  ipcMain.handle('config:resetDataPath', async () => {
    try {
      return resetDataDir();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });
}
