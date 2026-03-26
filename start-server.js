// 独立启动后端 Express 服务器（无需 Electron）
// 用法: node d:\source\cc\FTree\start-server.js
const esbuild = require('esbuild');
const path = require('path');

const PROJECT_DIR = __dirname;
const outFile = path.join(PROJECT_DIR, '.server-bundle.cjs');

async function main() {
  // 使用 esbuild 编译后端 TypeScript
  console.log('[FTree] Building server...');
  await esbuild.build({
    entryPoints: [path.join(PROJECT_DIR, 'src/main/server-standalone.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outFile,
    external: ['express', 'uuid'],
    target: 'node18',
  });

  console.log('[FTree] Starting server...');
  require(outFile);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
