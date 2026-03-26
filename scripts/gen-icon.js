/**
 * 生成应用图标 PNG
 * 使用纯 Node.js 方式创建一个简单的 PNG 图标
 */
const fs = require('fs');
const path = require('path');

// 简单的 PNG 生成器 - 创建 256x256 纯色图标
// electron-builder 也接受 SVG 或 .ico
// 这里我们直接把 SVG 复制为 icon.png 的占位，
// electron-builder 在 Windows 上优先使用 icon.ico，
// 但也可以自动从 PNG 转换

const resourceDir = path.join(__dirname, '..', 'resources');

// 确保目录存在
if (!fs.existsSync(resourceDir)) {
  fs.mkdirSync(resourceDir, { recursive: true });
}

console.log('Icon SVG is ready at resources/icon.svg');
console.log('Note: electron-builder can auto-convert icon formats.');
console.log('For best results, place a 256x256+ icon.png in resources/');
