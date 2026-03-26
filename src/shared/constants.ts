/** 默认 HTTP 服务端口 */
export const DEFAULT_PORT = 17800;

/** API 路径前缀 */
export const API_PREFIX = '/api';

/** 分片大小：每个详情文件存储的人数 */
export const CHUNK_SIZE = 500;

/** 最大支持人数 */
export const MAX_PERSONS = 50000;

/** 加密相关参数 */
export const CRYPTO = {
  ALGORITHM: 'aes-256-gcm' as const,
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  TAG_LENGTH: 16,
  SALT_LENGTH: 32,
  PBKDF2_ITERATIONS: 100000,
  DIGEST: 'sha512' as const,
};

/** 备份保留数量 */
export const MAX_BACKUPS = 5;

/** LRU 缓存容量 */
export const LRU_CACHE_SIZE = 200;

/** 数据目录名 */
export const DATA_DIR_NAME = 'ftree-data';

/** 数据路径配置文件名（存放在 app.getPath('userData') 或 homedir 下） */
export const DATA_PATH_CONFIG = '.ftree-data-path.json';

/** 文件名常量 */
export const FILES = {
  CONFIG: 'config.json',
  INDEX: 'index.json',
  INDEX_ENC: 'index.enc',
  FAMILY_META_ENC: 'family_meta.enc',
  DETAILS_DIR: 'details',
  BACKUPS_DIR: 'backups',
};
