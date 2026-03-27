import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DEFAULT_PORT } from '../shared/constants';
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

  // ==================== 认证 API ====================

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password) {
        res.status(400).json({ success: false, error: '密码不能为空' });
        return;
      }
      setupPassword(password);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password) {
        res.json({ success: false, error: '密码不能为空' });
        return;
      }
      const ok = initialize(password);
      if (!ok) {
        res.json({ success: false, error: '密码错误' });
        return;
      }
      res.json({ success: true });
    } catch (e: any) {
      res.json({ success: false, error: e.message });
    }
  });

  app.get('/api/auth/check', async (_req: Request, res: Response) => {
    try {
      res.json({ initialized: isInitialized(), loggedIn: isLoggedIn() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 人员管理 API ====================
  // 前端使用 /person (单数)

  app.get('/api/person', async (req: Request, res: Response) => {
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

  app.post('/api/person', async (req: Request, res: Response) => {
    try {
      const person = createPerson(req.body);
      res.json(person);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/person/:id', async (req: Request, res: Response) => {
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

  app.put('/api/person/:id', async (req: Request, res: Response) => {
    try {
      const person = updatePerson(req.params.id, req.body);
      res.json(person);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/person/:id', async (req: Request, res: Response) => {
    try {
      deletePerson(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 树数据 API ====================

  app.get('/api/tree', async (_req: Request, res: Response) => {
    try {
      const data = getTreeData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/tree/children/:parentId', async (req: Request, res: Response) => {
    try {
      const data = getChildren(req.params.parentId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/tree/reorder', async (req: Request, res: Response) => {
    try {
      const { parentId, orderedIds } = req.body;
      reorderChildren(parentId, orderedIds);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 数据导入导出 API ====================

  app.post('/api/data/export', async (_req: Request, res: Response) => {
    try {
      const data = exportData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/data/import', async (req: Request, res: Response) => {
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

  app.post('/api/data/backup', async (_req: Request, res: Response) => {
    try {
      const backupPath = backup();
      res.json({ path: backupPath });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/data/clear', async (_req: Request, res: Response) => {
    try {
      clearAllData();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 辈分字配置 API ====================

  app.get('/api/config/generation-chars', async (_req: Request, res: Response) => {
    try {
      const data = getGenerationChars();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/config/generation-chars', async (req: Request, res: Response) => {
    try {
      saveGenerationChars(req.body);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 导出图片 API ====================
  // 前端发送 FormData (multipart/form-data)，文件字段名为 'file'

  app.post('/api/export/image', async (req: Request, res: Response) => {
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
