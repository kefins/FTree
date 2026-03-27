import fs from 'fs';
import path from 'path';
import os from 'os';
import { encrypt, decrypt } from './crypto-service';
import {
  CHUNK_SIZE,
  FILES,
  DATA_DIR_NAME,
  DATA_PATH_CONFIG,
  MAX_BACKUPS,
} from '../shared/constants';

// ======================== 数据目录路径管理 ========================

/** 内存缓存：自定义数据目录路径（null 表示使用默认） */
let customDataDir: string | null = null;
/** 标记是否已从配置文件中加载过自定义路径 */
let dataDirLoaded = false;

/** 获取路径配置文件的存储位置（放在用户主目录下，不受数据目录迁移影响） */
function getPathConfigFile(): string {
  return path.join(os.homedir(), DATA_PATH_CONFIG);
}

/** 从配置文件加载自定义数据目录路径 */
function loadCustomDataDir(): void {
  if (dataDirLoaded) return;
  dataDirLoaded = true;
  try {
    const configFile = getPathConfigFile();
    if (fs.existsSync(configFile)) {
      const content = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (content.dataDir && typeof content.dataDir === 'string') {
        customDataDir = content.dataDir;
      }
    }
  } catch {
    // 读取失败则使用默认路径
    customDataDir = null;
  }
}

/** 获取默认数据目录路径 */
export function getDefaultDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

/** 数据根目录（支持自定义路径） */
export function getDataDir(): string {
  loadCustomDataDir();
  return customDataDir || getDefaultDataDir();
}

/** 获取当前配置的数据目录路径 */
export function getConfiguredDataPath(): string {
  return getDataDir();
}

/** 保存自定义数据目录路径到配置文件 */
function saveDataPathConfig(dataDir: string | null): void {
  const configFile = getPathConfigFile();
  if (dataDir) {
    fs.writeFileSync(configFile, JSON.stringify({ dataDir }, null, 2), 'utf8');
  } else {
    // 恢复默认：删除配置文件
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }
  }
  customDataDir = dataDir;
}

/**
 * 修改数据存储位置
 * @param newDir 新的数据目录路径
 * @param migrate 是否迁移现有数据到新目录
 * @returns 操作结果消息
 */
export function changeDataDir(newDir: string, migrate: boolean): string {
  const oldDir = getDataDir();
  const resolvedNew = path.resolve(newDir);

  // 不能设置为当前目录
  if (path.resolve(oldDir) === resolvedNew) {
    throw new Error('新路径与当前路径相同');
  }

  // 确保新目录存在
  if (!fs.existsSync(resolvedNew)) {
    fs.mkdirSync(resolvedNew, { recursive: true });
  }

  // 检查新目录是否可写
  try {
    const testFile = path.join(resolvedNew, '.write-test');
    fs.writeFileSync(testFile, 'test', 'utf8');
    fs.unlinkSync(testFile);
  } catch {
    throw new Error('目标目录不可写，请检查权限');
  }

  if (migrate && fs.existsSync(oldDir)) {
    // 迁移数据：复制所有文件到新目录
    copyDirRecursive(oldDir, resolvedNew);
  }

  // 保存新路径配置
  saveDataPathConfig(resolvedNew);

  return resolvedNew;
}

/** 恢复为默认数据目录 */
export function resetDataDir(): string {
  saveDataPathConfig(null);
  const defaultDir = getDefaultDataDir();
  return defaultDir;
}

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** 确保数据目录结构存在 */
export function ensureDataDir(): void {
  const dataDir = getDataDir();
  const detailsDir = path.join(dataDir, FILES.DETAILS_DIR);
  const backupsDir = path.join(dataDir, FILES.BACKUPS_DIR);

  for (const dir of [dataDir, detailsDir, backupsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/** 原子写入：先写临时文件再重命名 */
function atomicWrite(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, data, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/** 读取配置文件 */
export function readConfig(): Record<string, unknown> | null {
  const configPath = path.join(getDataDir(), FILES.CONFIG);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 写入配置文件 */
export function writeConfig(config: Record<string, unknown>): void {
  ensureDataDir();
  const configPath = path.join(getDataDir(), FILES.CONFIG);
  atomicWrite(configPath, JSON.stringify(config, null, 2));
}

/** 读取加密索引文件 */
export function readIndex(key: Buffer): unknown[] | null {
  const indexPath = path.join(getDataDir(), FILES.INDEX_ENC);
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const decrypted = decrypt(raw.encrypted, raw.iv, raw.tag, key);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/** 写入加密索引文件 */
export function writeIndex(data: unknown[], key: Buffer): void {
  ensureDataDir();
  const indexPath = path.join(getDataDir(), FILES.INDEX_ENC);
  const json = JSON.stringify(data);
  const encData = encrypt(json, key);
  atomicWrite(indexPath, JSON.stringify(encData));
}

/** 获取分片文件路径 */
function getChunkPath(chunkId: number): string {
  return path.join(getDataDir(), FILES.DETAILS_DIR, `chunk_${chunkId}.enc`);
}

/** 根据人员索引号计算分片编号 */
export function getChunkId(personIndex: number): number {
  return Math.floor(personIndex / CHUNK_SIZE);
}

/** 读取加密分片 */
export function readChunk(
  chunkId: number,
  key: Buffer
): Record<string, unknown> | null {
  const chunkPath = getChunkPath(chunkId);
  if (!fs.existsSync(chunkPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
    const decrypted = decrypt(raw.encrypted, raw.iv, raw.tag, key);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/** 写入加密分片 */
export function writeChunk(
  chunkId: number,
  data: Record<string, unknown>,
  key: Buffer
): void {
  ensureDataDir();
  const chunkPath = getChunkPath(chunkId);
  const json = JSON.stringify(data);
  const encData = encrypt(json, key);
  atomicWrite(chunkPath, JSON.stringify(encData));
}

/** 读取加密的家族元数据文件（字辈等） */
export function readFamilyMeta(key: Buffer): Record<string, unknown> | null {
  const metaPath = path.join(getDataDir(), FILES.FAMILY_META_ENC);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const decrypted = decrypt(raw.encrypted, raw.iv, raw.tag, key);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/** 写入加密的家族元数据文件 */
export function writeFamilyMeta(data: Record<string, unknown>, key: Buffer): void {
  ensureDataDir();
  const metaPath = path.join(getDataDir(), FILES.FAMILY_META_ENC);
  const json = JSON.stringify(data);
  const encData = encrypt(json, key);
  atomicWrite(metaPath, JSON.stringify(encData));
}

/** 清除所有分片文件 */
export function clearChunks(): void {
  const detailsDir = path.join(getDataDir(), FILES.DETAILS_DIR);
  if (fs.existsSync(detailsDir)) {
    for (const file of fs.readdirSync(detailsDir)) {
      if (file.startsWith('chunk_') && file.endsWith('.enc')) {
        fs.unlinkSync(path.join(detailsDir, file));
      }
    }
  }
}

/** 创建备份，保留最近 MAX_BACKUPS 个 */
export function createBackup(key: Buffer): string {
  ensureDataDir();
  const dataDir = getDataDir();
  const backupsDir = path.join(dataDir, FILES.BACKUPS_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupsDir, `backup_${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  // 复制配置文件
  const configSrc = path.join(dataDir, FILES.CONFIG);
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(backupDir, FILES.CONFIG));
  }

  // 复制加密索引
  const indexSrc = path.join(dataDir, FILES.INDEX_ENC);
  if (fs.existsSync(indexSrc)) {
    fs.copyFileSync(indexSrc, path.join(backupDir, FILES.INDEX_ENC));
  }

  // 复制家族元数据
  const metaSrc = path.join(dataDir, FILES.FAMILY_META_ENC);
  if (fs.existsSync(metaSrc)) {
    fs.copyFileSync(metaSrc, path.join(backupDir, FILES.FAMILY_META_ENC));
  }

  // 复制用户数据
  const usersSrc = path.join(dataDir, FILES.USERS_ENC);
  if (fs.existsSync(usersSrc)) {
    fs.copyFileSync(usersSrc, path.join(backupDir, FILES.USERS_ENC));
  }

  // 复制所有分片文件
  const detailsSrc = path.join(dataDir, FILES.DETAILS_DIR);
  if (fs.existsSync(detailsSrc)) {
    const detailsDest = path.join(backupDir, FILES.DETAILS_DIR);
    fs.mkdirSync(detailsDest, { recursive: true });
    for (const file of fs.readdirSync(detailsSrc)) {
      fs.copyFileSync(
        path.join(detailsSrc, file),
        path.join(detailsDest, file)
      );
    }
  }

  // 清理旧备份，保留最近 MAX_BACKUPS 个
  const backups = fs
    .readdirSync(backupsDir)
    .filter((d) => d.startsWith('backup_'))
    .sort();

  while (backups.length > MAX_BACKUPS) {
    const oldest = backups.shift()!;
    const oldestPath = path.join(backupsDir, oldest);
    fs.rmSync(oldestPath, { recursive: true, force: true });
  }

  return backupDir;
}
