import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DEFAULT_PORT } from '../shared/constants';
import type { UserRole } from '../shared/constants';
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
  isInitialized,
  isV1Mode,
  isV2Mode,
  setupFirstUser,
  login,
  logout,
  getSessionByToken,
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
import type { Session } from './user-service';

// 扩展 Request 类型，附加 session 信息
declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/** 认证中间件 */
function authMiddleware(requiredRole?: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. 尝试从 Authorization header 提取 token
    const authHeader = req.headers.authorization;
    let session: Session | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      session = getSessionByToken(token);
    }

    // 2. 回退到当前进程内会话（IPC 单用户模式）
    if (!session) {
      session = getCurrentSession();
    }

    if (!session) {
      res.status(401).json({ success: false, error: '未登录' });
      return;
    }

    // 3. 检查角色权限
    if (requiredRole) {
      const roleLevel: Record<UserRole, number> = {
        admin: 3,
        editor: 2,
        viewer: 1,
      };
      if (roleLevel[session.role] < roleLevel[requiredRole]) {
        res.status(403).json({ success: false, error: '权限不足' });
        return;
      }
    }

    // 4. 将 session 挂到 req 上
    req.session = session;
    next();
  };
}

/** 创建并配置 Express 应用 */
export function createExpressApp(): express.Application {
  const app = express();

  // CORS 中间件 —— 允许 Vite dev server 跨域请求
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // 中间件
  app.use(express.json({ limit: '50mb' }));

  // 托管前端静态文件
  const distPath = path.join(__dirname, '../../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
  }

  // ==================== 认证 API（公开） ====================

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    try {
      const { username, password, displayName } = req.body;
      if (!password) {
        res.status(400).json({ success: false, error: '密码不能为空' });
        return;
      }
      if (!username) {
        res.status(400).json({ success: false, error: '用户名不能为空' });
        return;
      }
      const session = setupFirstUser(username, password, displayName);
      // 初始化空索引
      initEmptyIndex();
      res.json({
        success: true,
        token: session.token,
        user: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!password) {
        res.json({ success: false, error: '密码不能为空' });
        return;
      }

      const result = login(username || 'admin', password);

      // 加载索引
      loadIndex();

      // 如果需要 V1→V2 迁移
      if (result.needMigration) {
        migrateV1ToV2(username || 'admin', password);
        syncBootstrapAfterMigration();
      }

      res.json({
        success: true,
        token: result.session.token,
        user: {
          id: result.session.userId,
          username: result.session.username,
          displayName: result.session.displayName,
          role: result.session.role,
        },
        needMigration: result.needMigration,
      });
    } catch (e: any) {
      res.json({ success: false, error: e.message });
    }
  });

  app.get('/api/auth/check', async (_req: Request, res: Response) => {
    try {
      const initialized = isInitialized();
      const loggedIn = isLoggedIn();
      const v2 = isV2Mode();
      const usernames = v2 ? getAvailableUsernames() : [];
      const session = getCurrentSession();
      res.json({
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
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/auth/me', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      const user = getCurrentUser();
      if (!user) {
        res.status(401).json({ success: false, error: '未登录' });
        return;
      }
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/auth/password', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        res.status(400).json({ success: false, error: '缺少必要参数' });
        return;
      }
      if (newPassword.length < 4) {
        res.status(400).json({ success: false, error: '新密码至少 4 位' });
        return;
      }
      changeOwnPassword(req.session!.userId, oldPassword, newPassword);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        logout(authHeader.substring(7));
      } else {
        logout();
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 用户管理 API（仅 admin） ====================

  app.get('/api/users', authMiddleware('admin'), async (_req: Request, res: Response) => {
    try {
      const users = listUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/users', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      const { username, displayName, password, role } = req.body;
      if (!username || !password) {
        res.status(400).json({ success: false, error: '用户名和密码不能为空' });
        return;
      }
      const user = createUser({ username, displayName: displayName || username, password, role: role || 'viewer' });
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/users/:id', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      const user = updateUser(req.params.id, req.body);
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/users/:id', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      deleteUser(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/users/:id/reset-password', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword) {
        res.status(400).json({ success: false, error: '新密码不能为空' });
        return;
      }
      resetUserPassword(req.params.id, newPassword);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/users/:id/toggle', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      const user = toggleUser(req.params.id);
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 人员管理 API ====================
  // 前端使用 /person (单数)

  app.get('/api/person', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      const query = {
        search: req.query.search as string | undefined,
        gender: req.query.gender as 'male' | 'female' | undefined,
        generation: req.query.generation
          ? Number(req.query.generation)
          : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      };
      const result = listPersons(query);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/person', authMiddleware('editor'), async (req: Request, res: Response) => {
    try {
      const person = createPerson(req.body);
      res.json(person);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/person/:id', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      const person = getPerson(req.params.id);
      if (!person) {
        res.status(404).json({ success: false, error: '人员不存在' });
        return;
      }
      res.json(person);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/person/:id', authMiddleware('editor'), async (req: Request, res: Response) => {
    try {
      const person = updatePerson(req.params.id, req.body);
      res.json(person);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/person/:id', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      deletePerson(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 树数据 API ====================

  app.get('/api/tree', authMiddleware('viewer'), async (_req: Request, res: Response) => {
    try {
      const data = getTreeData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/tree/children/:parentId', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      const data = getChildren(req.params.parentId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/tree/reorder', authMiddleware('editor'), async (req: Request, res: Response) => {
    try {
      const { parentId, orderedIds } = req.body;
      reorderChildren(parentId, orderedIds);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 数据导入导出 API ====================

  app.post('/api/data/export', authMiddleware('admin'), async (_req: Request, res: Response) => {
    try {
      const data = exportData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/data/import', authMiddleware('admin'), async (req: Request, res: Response) => {
    try {
      // 兼容新格式（含 persons + generationChars 的对象）和旧格式（纯数组或 { data: [...] }）
      const body = req.body;
      if (Array.isArray(body)) {
        importData(body);
      } else if (body.persons) {
        importData(body);
      } else if (body.data) {
        importData(body.data);
      } else {
        res.status(400).json({ success: false, error: '数据格式不正确' });
        return;
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/data/backup', authMiddleware('admin'), async (_req: Request, res: Response) => {
    try {
      const backupPath = backup();
      res.json({ path: backupPath });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/data/clear', authMiddleware('admin'), async (_req: Request, res: Response) => {
    try {
      clearAllData();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 辈分字配置 API ====================

  app.get('/api/config/generation-chars', authMiddleware('viewer'), async (_req: Request, res: Response) => {
    try {
      const data = getGenerationChars();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/config/generation-chars', authMiddleware('editor'), async (req: Request, res: Response) => {
    try {
      saveGenerationChars(req.body);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 导出图片 API ====================
  // 前端发送 FormData (multipart/form-data)，文件字段名为 'file'

  app.post('/api/export/image', authMiddleware('viewer'), async (req: Request, res: Response) => {
    try {
      // 手动解析 multipart 数据
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          // 保存到临时目录
          const tmpDir = path.join(os.tmpdir(), 'ftree-exports');
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
          }
          const filename = `家谱_${Date.now()}.png`;
          const filePath = path.join(tmpDir, filename);
          fs.writeFileSync(filePath, buffer);
          res.json({ path: filePath });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // SPA fallback：非 API 请求返回 index.html
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Not Found');
    }
  });

  return app;
}

/** 启动 Express 服务，仅绑定 localhost */
export function startServer(port: number = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = createExpressApp();
    const server = app.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`FTree server running at http://127.0.0.1:${actualPort}`);
      resolve(actualPort);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${port} in use, trying ${port + 1}...`);
        server.close();
        resolve(startServer(port + 1));
      } else {
        reject(err);
      }
    });
  });
}
