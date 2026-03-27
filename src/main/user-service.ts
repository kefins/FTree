import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  deriveKey,
  hashPassword as cryptoHashPassword,
  verifyPassword as cryptoVerifyPassword,
  encrypt,
  decrypt,
} from './crypto-service';
import {
  readConfig,
  writeConfig,
  ensureDataDir,
  getDataDir,
} from './file-manager';
import { CRYPTO, FILES, SESSION_EXPIRE_MS } from '../shared/constants';
import type { UserRole } from '../shared/constants';
import fs from 'fs';
import path from 'path';

// ======================== 类型定义 ========================

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  passwordSalt: string;
  /** 用该用户密钥加密的主密钥副本 */
  encryptedMasterKey: string;
  masterKeyIV: string;
  masterKeyTag: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  disabled?: boolean;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  disabled?: boolean;
}

export interface Session {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  token: string;
  loginAt: number;
}

export interface CreateUserDTO {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserDTO {
  displayName?: string;
  role?: UserRole;
}

// ======================== 内部状态 ========================

/** 主密钥（登录后保存在内存中） */
let masterKey: Buffer | null = null;

/** 当前会话（IPC 模式使用） */
let currentSession: Session | null = null;

/** HTTP 会话映射（token → session） */
const sessions = new Map<string, Session>();

/** 用户列表缓存 */
let usersCache: UserRecord[] | null = null;

// ======================== 工具函数 ========================

function requireMasterKey(): Buffer {
  if (!masterKey) throw new Error('未登录，请先验证密码');
  return masterKey;
}

/** 用用户密码派生的 userKey 加密主密钥 */
function encryptMasterKey(
  mk: Buffer,
  userPassword: string,
  userSalt: string
): { encryptedMasterKey: string; masterKeyIV: string; masterKeyTag: string } {
  const userKey = deriveKey(userPassword, Buffer.from(userSalt, 'hex'));
  const result = encrypt(mk.toString('hex'), userKey);
  return {
    encryptedMasterKey: result.encrypted,
    masterKeyIV: result.iv,
    masterKeyTag: result.tag,
  };
}

/** 用用户密码派生的 userKey 解密主密钥 */
function decryptMasterKey(
  user: UserRecord,
  password: string
): Buffer {
  const userKey = deriveKey(password, Buffer.from(user.passwordSalt, 'hex'));
  const mkHex = decrypt(
    user.encryptedMasterKey,
    user.masterKeyIV,
    user.masterKeyTag,
    userKey
  );
  return Buffer.from(mkHex, 'hex');
}

/** 读取加密的用户列表文件 */
function readUsersFile(key: Buffer): UserRecord[] {
  const usersPath = path.join(getDataDir(), FILES.USERS_ENC);
  if (!fs.existsSync(usersPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const decrypted = decrypt(raw.encrypted, raw.iv, raw.tag, key);
    return JSON.parse(decrypted);
  } catch {
    return [];
  }
}

/** 写入加密的用户列表文件 */
function writeUsersFile(users: UserRecord[], key: Buffer): void {
  ensureDataDir();
  const usersPath = path.join(getDataDir(), FILES.USERS_ENC);
  const json = JSON.stringify(users);
  const encData = encrypt(json, key);
  const tmpPath = usersPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(encData), 'utf8');
  fs.renameSync(tmpPath, usersPath);
}

/** 加载用户列表（带缓存） */
function loadUsers(): UserRecord[] {
  if (usersCache) return usersCache;
  const mk = requireMasterKey();
  usersCache = readUsersFile(mk);
  return usersCache;
}

/** 保存用户列表 */
function saveUsers(users: UserRecord[]): void {
  const mk = requireMasterKey();
  writeUsersFile(users, mk);
  usersCache = users;
}

/** 将 UserRecord 转换为 UserInfo（隐藏敏感信息） */
function toUserInfo(user: UserRecord): UserInfo {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    disabled: user.disabled,
  };
}

/** 生成 token */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ======================== 数据迁移 ========================

/**
 * 检查是否为旧版数据（单用户模式），若是则自动迁移到多用户模式。
 * 迁移策略：旧密码的派生密钥直接作为主密钥使用，
 * 这样 index.enc、chunk_N.enc 等数据文件完全不需要重新加密。
 */
export function checkAndMigrateV1(): boolean {
  const config = readConfig();
  if (!config) return false;

  // 已经是 v2 了，无需迁移
  if (config.version === 2) return false;

  // 有 passwordHash 但没有 version → v1 旧数据
  if (config.passwordHash) {
    return true; // 标记为需要迁移
  }

  return false;
}

/**
 * 执行从 v1 到 v2 的迁移。
 * 调用此函数时用户已经用旧密码成功登录，masterKey 已设置好。
 *
 * 注意：旧模式下 password → PBKDF2(password, salt) → encryptionKey
 * 新模式下这个 encryptionKey 直接作为 masterKey 使用。
 */
export function migrateV1ToV2(
  username: string,
  password: string,
  displayName?: string
): void {
  const mk = requireMasterKey();
  const config = readConfig();
  if (!config) throw new Error('配置文件不存在');

  // 创建管理员用户
  const { hash, salt } = cryptoHashPassword(password);
  const mkEncrypted = encryptMasterKey(mk, password, salt);

  const adminUser: UserRecord = {
    id: uuidv4(),
    username,
    displayName: displayName || username,
    role: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    ...mkEncrypted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  // 保存用户文件
  writeUsersFile([adminUser], mk);
  usersCache = [adminUser];

  // 更新 config.json：标记为 v2（保留旧字段以备兼容）
  writeConfig({
    ...config,
    version: 2,
  });

  // 创建会话
  currentSession = {
    userId: adminUser.id,
    username: adminUser.username,
    displayName: adminUser.displayName,
    role: adminUser.role,
    token: generateToken(),
    loginAt: Date.now(),
  };
  sessions.set(currentSession.token, currentSession);
}

// ======================== 认证 API ========================

/** 检查是否已初始化 */
export function isInitialized(): boolean {
  const config = readConfig();
  return config !== null && config.passwordHash !== undefined;
}

/** 检查是否已登录 */
export function isLoggedIn(): boolean {
  return masterKey !== null && currentSession !== null;
}

/** 检查是否为 V1 旧模式（单密码模式） */
export function isV1Mode(): boolean {
  const config = readConfig();
  if (!config) return false;
  return config.passwordHash !== undefined && config.version !== 2;
}

/** 检查是否为 V2 多用户模式 */
export function isV2Mode(): boolean {
  const config = readConfig();
  if (!config) return false;
  return config.version === 2;
}

/**
 * 首次初始化：设置密码并创建管理员用户
 * 替代旧的 setupPassword
 */
export function setupFirstUser(
  username: string,
  password: string,
  displayName?: string
): Session {
  if (isInitialized()) {
    throw new Error('系统已初始化，不可重复设置');
  }

  ensureDataDir();

  // 生成随机主密钥
  const mk = crypto.randomBytes(CRYPTO.KEY_LENGTH);
  masterKey = mk;

  // 创建 config.json（v2 版本）
  // 为了迁移兼容，也保存 passwordHash/passwordSalt
  const { hash: configHash, salt: configSalt } = cryptoHashPassword(password);
  writeConfig({
    version: 2,
    passwordHash: configHash,
    passwordSalt: configSalt,
    createdAt: new Date().toISOString(),
  });

  // 创建管理员用户
  const { hash, salt } = cryptoHashPassword(password);
  const mkEncrypted = encryptMasterKey(mk, password, salt);

  const adminUser: UserRecord = {
    id: uuidv4(),
    username,
    displayName: displayName || username,
    role: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    ...mkEncrypted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 保存用户文件
  writeUsersFile([adminUser], mk);
  usersCache = [adminUser];

  // 创建会话
  const session: Session = {
    userId: adminUser.id,
    username: adminUser.username,
    displayName: adminUser.displayName,
    role: adminUser.role,
    token: generateToken(),
    loginAt: Date.now(),
  };
  currentSession = session;
  sessions.set(session.token, session);

  return session;
}

/**
 * 用户登录
 * 支持 V1（单密码模式）和 V2（多用户模式）
 */
export function login(
  username: string,
  password: string
): { session: Session; needMigration: boolean } {
  const config = readConfig();
  if (!config) throw new Error('尚未初始化，请先设置密码');

  // V1 兼容模式：单密码登录
  if (config.version !== 2) {
    const oldHash = config.passwordHash as string;
    const oldSalt = config.passwordSalt as string;

    if (!cryptoVerifyPassword(password, oldHash, oldSalt)) {
      throw new Error('密码错误');
    }

    // 旧密码派生的密钥就是主密钥
    masterKey = deriveKey(password, Buffer.from(oldSalt, 'hex'));

    // 创建临时会话
    const session: Session = {
      userId: 'v1-admin',
      username: username || 'admin',
      displayName: username || '管理员',
      role: 'admin',
      token: generateToken(),
      loginAt: Date.now(),
    };
    currentSession = session;
    sessions.set(session.token, session);

    return { session, needMigration: true };
  }

  // V2 多用户模式
  // 先用 config 中的旧密码信息派生主密钥来读取用户列表
  // 不…V2 模式下主密钥存储在每个用户的 encryptedMasterKey 中
  // 我们需要先找到该用户的记录，用用户密码解密出主密钥

  // 问题：users.enc 是用主密钥加密的，而主密钥需要用用户密码解密。
  // 解决方案：在 V2 模式下，config.json 中仍保留 passwordHash/passwordSalt
  // 作为"引导盐值"，首先用这个盐值尝试派生一个临时密钥来读取 users.enc
  // 但更好的方案：在 config.json 中保存一份额外的 masterKey 加密副本(用主密钥自身加密 users.enc)
  // 实际上当前设计中 users.enc 本身就是用主密钥加密的
  // 所以我们需要一种"引导"方法来获取主密钥

  // 更好的方案：users.enc 不用主密钥加密，而是明文存储用户记录（密码已经hash过）
  // 但 encryptedMasterKey 字段是安全的（用各用户密钥加密）
  // 这样任何人都可以读取用户列表，但不能解密主密钥

  // 让我们采用这个方案：users.enc 改为明文 users.json
  // 不对，用户名信息也应该保护。那就保持 users.enc 用主密钥加密
  // 但在 config.json 中额外保存一份 bootstrap 信息

  // 最终方案：在 config.json 中保存所有用户的"引导记录"
  // 每个记录包含 { userId, username, passwordHash, passwordSalt, encryptedMasterKey, iv, tag }
  // config.json 是明文的，但密码已 hash，主密钥已加密，所以安全性没问题

  const userBootstrap = config.users as Array<{
    userId: string;
    username: string;
    passwordHash: string;
    passwordSalt: string;
    encryptedMasterKey: string;
    masterKeyIV: string;
    masterKeyTag: string;
  }>;

  if (!userBootstrap || !Array.isArray(userBootstrap)) {
    throw new Error('用户数据损坏');
  }

  // 找到对应用户名
  const bootstrapRecord = userBootstrap.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!bootstrapRecord) {
    throw new Error('用户名或密码错误');
  }

  // 验证密码
  if (
    !cryptoVerifyPassword(
      password,
      bootstrapRecord.passwordHash,
      bootstrapRecord.passwordSalt
    )
  ) {
    throw new Error('用户名或密码错误');
  }

  // 解密主密钥
  const userKey = deriveKey(
    password,
    Buffer.from(bootstrapRecord.passwordSalt, 'hex')
  );
  let mk: Buffer;
  try {
    const mkHex = decrypt(
      bootstrapRecord.encryptedMasterKey,
      bootstrapRecord.masterKeyIV,
      bootstrapRecord.masterKeyTag,
      userKey
    );
    mk = Buffer.from(mkHex, 'hex');
  } catch {
    throw new Error('用户名或密码错误');
  }

  masterKey = mk;

  // 读取完整用户列表
  const users = readUsersFile(mk);
  usersCache = users;

  // 找到完整用户记录
  const fullUser = users.find((u) => u.id === bootstrapRecord.userId);
  if (!fullUser) {
    throw new Error('用户数据不一致');
  }

  // 检查是否被禁用
  if (fullUser.disabled) {
    masterKey = null;
    usersCache = null;
    throw new Error('该账号已被禁用');
  }

  // 更新最后登录时间
  fullUser.lastLoginAt = new Date().toISOString();
  saveUsers(users);

  // 创建会话
  const session: Session = {
    userId: fullUser.id,
    username: fullUser.username,
    displayName: fullUser.displayName,
    role: fullUser.role,
    token: generateToken(),
    loginAt: Date.now(),
  };
  currentSession = session;
  sessions.set(session.token, session);

  return { session, needMigration: false };
}

/** 登出 */
export function logout(token?: string): void {
  if (token) {
    sessions.delete(token);
    if (currentSession?.token === token) {
      currentSession = null;
    }
  } else {
    currentSession = null;
  }

  // 如果所有会话都没了，清除主密钥
  if (sessions.size === 0 && !currentSession) {
    masterKey = null;
    usersCache = null;
  }
}

/** 获取当前会话 */
export function getCurrentSession(): Session | null {
  return currentSession;
}

/** 通过 token 获取会话 */
export function getSessionByToken(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;

  // 检查是否过期
  if (Date.now() - session.loginAt > SESSION_EXPIRE_MS) {
    sessions.delete(token);
    if (currentSession?.token === token) {
      currentSession = null;
    }
    return null;
  }

  return session;
}

/** 获取当前用户信息 */
export function getCurrentUser(): UserInfo | null {
  if (!currentSession) return null;
  const users = loadUsers();
  const user = users.find((u) => u.id === currentSession!.userId);
  return user ? toUserInfo(user) : null;
}

/** 获取主密钥（供 data-service 使用） */
export function getMasterKey(): Buffer | null {
  return masterKey;
}

/** 设置主密钥（供 data-service 的 V1 兼容模式使用） */
export function setMasterKey(key: Buffer): void {
  masterKey = key;
}

// ======================== 用户管理 API（仅 admin） ========================

/** 同步引导记录到 config.json */
function syncBootstrapRecords(users: UserRecord[]): void {
  const config = readConfig() || {};
  config.users = users
    .filter((u) => !u.disabled)
    .map((u) => ({
      userId: u.id,
      username: u.username,
      passwordHash: u.passwordHash,
      passwordSalt: u.passwordSalt,
      encryptedMasterKey: u.encryptedMasterKey,
      masterKeyIV: u.masterKeyIV,
      masterKeyTag: u.masterKeyTag,
    }));
  config.version = 2;
  writeConfig(config);
}

/** 获取用户列表 */
export function listUsers(): UserInfo[] {
  const users = loadUsers();
  return users.map(toUserInfo);
}

/** 创建用户 */
export function createUser(data: CreateUserDTO): UserInfo {
  const mk = requireMasterKey();
  const users = loadUsers();

  // 检查用户名唯一
  if (
    users.some(
      (u) => u.username.toLowerCase() === data.username.toLowerCase()
    )
  ) {
    throw new Error(`用户名 "${data.username}" 已存在`);
  }

  // 哈希密码
  const { hash, salt } = cryptoHashPassword(data.password);

  // 用用户密钥加密主密钥
  const mkEncrypted = encryptMasterKey(mk, data.password, salt);

  const newUser: UserRecord = {
    id: uuidv4(),
    username: data.username,
    displayName: data.displayName,
    role: data.role,
    passwordHash: hash,
    passwordSalt: salt,
    ...mkEncrypted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveUsers(users);
  syncBootstrapRecords(users);

  return toUserInfo(newUser);
}

/** 更新用户 */
export function updateUser(id: string, data: UpdateUserDTO): UserInfo {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('用户不存在');

  if (data.displayName !== undefined) {
    user.displayName = data.displayName;
  }
  if (data.role !== undefined) {
    // 不能降级最后一个 admin
    if (user.role === 'admin' && data.role !== 'admin') {
      const adminCount = users.filter(
        (u) => u.role === 'admin' && !u.disabled
      ).length;
      if (adminCount <= 1) {
        throw new Error('至少需要保留一个管理员');
      }
    }
    user.role = data.role;
  }
  user.updatedAt = new Date().toISOString();

  saveUsers(users);
  syncBootstrapRecords(users);

  return toUserInfo(user);
}

/** 删除用户 */
export function deleteUser(id: string): void {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('用户不存在');

  const user = users[idx];

  // 不能删除最后一个 admin
  if (user.role === 'admin') {
    const adminCount = users.filter(
      (u) => u.role === 'admin' && !u.disabled
    ).length;
    if (adminCount <= 1) {
      throw new Error('至少需要保留一个管理员');
    }
  }

  // 不能删除自己
  if (currentSession && currentSession.userId === id) {
    throw new Error('不能删除当前登录的账号');
  }

  users.splice(idx, 1);
  saveUsers(users);
  syncBootstrapRecords(users);

  // 清除该用户的所有会话
  for (const [token, session] of sessions.entries()) {
    if (session.userId === id) {
      sessions.delete(token);
    }
  }
}

/** 重置用户密码 */
export function resetUserPassword(id: string, newPassword: string): void {
  const mk = requireMasterKey();
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('用户不存在');

  // 新密码哈希
  const { hash, salt } = cryptoHashPassword(newPassword);

  // 用新密码派生的密钥重新加密主密钥
  const mkEncrypted = encryptMasterKey(mk, newPassword, salt);

  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.encryptedMasterKey = mkEncrypted.encryptedMasterKey;
  user.masterKeyIV = mkEncrypted.masterKeyIV;
  user.masterKeyTag = mkEncrypted.masterKeyTag;
  user.updatedAt = new Date().toISOString();

  saveUsers(users);
  syncBootstrapRecords(users);
}

/** 修改自己的密码 */
export function changeOwnPassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): void {
  const mk = requireMasterKey();
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('用户不存在');

  // 验证旧密码
  if (!cryptoVerifyPassword(oldPassword, user.passwordHash, user.passwordSalt)) {
    throw new Error('当前密码错误');
  }

  // 新密码哈希
  const { hash, salt } = cryptoHashPassword(newPassword);

  // 用新密码派生的密钥重新加密主密钥
  const mkEncrypted = encryptMasterKey(mk, newPassword, salt);

  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.encryptedMasterKey = mkEncrypted.encryptedMasterKey;
  user.masterKeyIV = mkEncrypted.masterKeyIV;
  user.masterKeyTag = mkEncrypted.masterKeyTag;
  user.updatedAt = new Date().toISOString();

  saveUsers(users);
  syncBootstrapRecords(users);
}

/** 启用/禁用用户 */
export function toggleUser(id: string): UserInfo {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('用户不存在');

  // 不能禁用最后一个 admin
  if (user.role === 'admin' && !user.disabled) {
    const adminCount = users.filter(
      (u) => u.role === 'admin' && !u.disabled
    ).length;
    if (adminCount <= 1) {
      throw new Error('至少需要保留一个启用的管理员');
    }
  }

  // 不能禁用自己
  if (currentSession && currentSession.userId === id && !user.disabled) {
    throw new Error('不能禁用当前登录的账号');
  }

  user.disabled = !user.disabled;
  user.updatedAt = new Date().toISOString();

  saveUsers(users);
  syncBootstrapRecords(users);

  // 如果禁用了，清除该用户的所有会话
  if (user.disabled) {
    for (const [token, session] of sessions.entries()) {
      if (session.userId === id) {
        sessions.delete(token);
      }
    }
  }

  return toUserInfo(user);
}

/**
 * V1 迁移完成后，同步 bootstrap 到 config.json
 */
export function syncBootstrapAfterMigration(): void {
  const users = loadUsers();
  syncBootstrapRecords(users);
}

/**
 * 获取可用用户名列表（用于登录页面展示）
 * 从 config.json 的 bootstrap 记录读取，不需要主密钥
 */
export function getAvailableUsernames(): string[] {
  const config = readConfig();
  if (!config) return [];

  // V1 模式没有用户名
  if (config.version !== 2) return [];

  const userBootstrap = config.users as Array<{ username: string }>;
  if (!userBootstrap || !Array.isArray(userBootstrap)) return [];

  return userBootstrap.map((u) => u.username);
}
