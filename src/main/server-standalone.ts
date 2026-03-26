/**
 * 独立启动 Express 服务器（脱离 Electron）
 * 用于纯浏览器开发模式: npx tsx src/main/server-standalone.ts
 */
import { startServer } from './express-server';
import { DEFAULT_PORT } from '../shared/constants';

async function main() {
  try {
    const port = await startServer(DEFAULT_PORT);
    console.log(`FTree standalone server running at http://127.0.0.1:${port}`);
    console.log('Press Ctrl+C to stop.');
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
