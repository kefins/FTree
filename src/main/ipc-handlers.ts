import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import {
  isLoggedIn,
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
  loadIndex,
  initEmptyIndex,
} from './data-service';
import {
  getConfiguredDataPath,
  getDefaultDataDir,
  changeDataDir,
  resetDataDir,
} from './file-manager';
import {
  isInitialized,
  isV1Mode,
  isV2Mode,
  setupFirstUser,
  login,
  logout,
  getCurrentSession,
  getCurrentUser,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  changeOwnPassword,
  toggleUser,
  migrateV1ToV2,
  syncBootstrapAfterMigration,
  getAvailableUsernames,
} from './user-service';

/** 注册所有 IPC handlers */
export function registerIPCHandlers(): void {
  // ==================== 认证 ====================

  ipcMain.handle('auth:check', async () => {
    try {
      const initialized = isInitialized();
      const loggedIn = isLoggedIn();
      const v2 = isV2Mode();
      const usernames = v2 ? getAvailableUsernames() : [];
      const session = getCurrentSession();
      return {
        initialized,
        loggedIn,
        v2,
        usernames,
        user: session
          ? {
              id: session.userId,
              username: session.username,
              displayName: session.displayName,
              role: session.role,
            }
          : undefined,
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:setup', async (_event, username: string, password: string, displayName?: string) => {
    try {
      const session = setupFirstUser(username, password, displayName);
      // 初始化空索引
      initEmptyIndex();
      return {
        token: session.token,
        user: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
        },
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:login', async (_event, username: string, password: string) => {
    try {
      console.log('[auth:login] attempting login for:', username || 'admin');
      const result = login(username || 'admin', password);
      console.log('[auth:login] login OK, needMigration:', result.needMigration);

      // 加载索引
      try {
        loadIndex();
        console.log('[auth:login] loadIndex OK');
      } catch (indexErr: any) {
        console.error('[auth:login] loadIndex failed:', indexErr.message);
        // 索引加载失败不阻止登录，可能是空数据
      }

      // 如果需要 V1→V2 迁移
      if (result.needMigration) {
        try {
          migrateV1ToV2(username || 'admin', password);
          syncBootstrapAfterMigration();
          console.log('[auth:login] V1→V2 migration OK');
        } catch (migrateErr: any) {
          console.error('[auth:login] migration failed:', migrateErr.message);
        }
      }

      return {
        success: true,
        token: result.session.token,
        user: {
          id: result.session.userId,
          username: result.session.username,
          displayName: result.session.displayName,
          role: result.session.role,
        },
        needMigration: result.needMigration,
      };
    } catch (e: any) {
      console.error('[auth:login] login failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:me', async () => {
    try {
      const user = getCurrentUser();
      return user;
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:changePassword', async (_event, oldPassword: string, newPassword: string) => {
    try {
      const session = getCurrentSession();
      if (!session) throw new Error('未登录');
      changeOwnPassword(session.userId, oldPassword, newPassword);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      logout();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('auth:resetData', async () => {
    try {
      const { getDataDir, ensureDataDir } = await import('./file-manager');
      const path = await import('path');
      const fsModule = await import('fs');
      const dataDir = getDataDir();

      // 创建备份目录
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.default.join(dataDir, 'reset-backup_' + timestamp);
      fsModule.default.mkdirSync(backupDir, { recursive: true });

      // 备份所有现有文件（不包括 backups 目录和 reset-backup 目录）
      const entries = fsModule.default.readdirSync(dataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('reset-backup_') || entry.name === 'backups') continue;
        const src = path.default.join(dataDir, entry.name);
        const dest = path.default.join(backupDir, entry.name);
        if (entry.isDirectory()) {
          // 递归复制
          const copyDir = (s: string, d: string) => {
            fsModule.default.mkdirSync(d, { recursive: true });
            for (const e of fsModule.default.readdirSync(s, { withFileTypes: true })) {
              if (e.isDirectory()) copyDir(path.default.join(s, e.name), path.default.join(d, e.name));
              else fsModule.default.copyFileSync(path.default.join(s, e.name), path.default.join(d, e.name));
            }
          };
          copyDir(src, dest);
        } else {
          fsModule.default.copyFileSync(src, dest);
        }
      }

      // 删除 config.json、index.enc、users.enc、family_meta.enc、details 目录
      const filesToDelete = ['config.json', 'index.enc', 'users.enc', 'family_meta.enc'];
      for (const file of filesToDelete) {
        const filePath = path.default.join(dataDir, file);
        if (fsModule.default.existsSync(filePath)) {
          fsModule.default.unlinkSync(filePath);
        }
      }
      // 删除 details 目录下所有分片文件
      const detailsDir = path.default.join(dataDir, 'details');
      if (fsModule.default.existsSync(detailsDir)) {
        for (const file of fsModule.default.readdirSync(detailsDir)) {
          fsModule.default.unlinkSync(path.default.join(detailsDir, file));
        }
      }

      console.log('[auth:resetData] data reset done, backup at:', backupDir);
      return { success: true, backupDir };
    } catch (e: any) {
      console.error('[auth:resetData] error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // ==================== 用户管理 ====================

  ipcMain.handle('users:list', async () => {
    try {
      return listUsers();
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('users:create', async (_event, data: { username: string; displayName: string; password: string; role: string }) => {
    try {
      return createUser(data as any);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('users:update', async (_event, id: string, data: { displayName?: string; role?: string }) => {
    try {
      return updateUser(id, data as any);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('users:delete', async (_event, id: string) => {
    try {
      deleteUser(id);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('users:resetPassword', async (_event, id: string, newPassword: string) => {
    try {
      resetUserPassword(id, newPassword);
    } catch (e: any) {
      throw new Error(e.message);
    }
  });

  ipcMain.handle('users:toggle', async (_event, id: string) => {
    try {
      return toggleUser(id);
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
