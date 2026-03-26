import { v4 as uuidv4 } from 'uuid';
import {
  deriveKey,
  hashPassword,
  verifyPassword as verifyPwd,
} from './crypto-service';
import {
  readConfig,
  writeConfig,
  readIndex,
  writeIndex,
  readChunk,
  writeChunk,
  getChunkId,
  ensureDataDir,
  clearChunks,
  readFamilyMeta,
  writeFamilyMeta,
  createBackup as createFileBackup,
} from './file-manager';
import { LRU_CACHE_SIZE } from '../shared/constants';

// ======================== 类型定义 ========================

export interface PersonIndex {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  parentId: string | null;
  /** 亲生父亲ID（过继场景） */
  biologicalParentId?: string | null;
  /** 配偶姓名 */
  spouseName?: string;
  sortOrder: number;
}

export interface Person extends PersonIndex {
  spouseName?: string;
  /** 配偶出生日期 */
  spouseBirthDate?: string;
  /** 配偶去世日期 */
  spouseDeathDate?: string;
  /** 配偶出生地/老家 */
  spouseBirthPlace?: string;
  /** 配偶职业 */
  spouseOccupation?: string;
  /** 配偶联系电话 */
  spousePhone?: string;
  /** 配偶联系地址 */
  spouseAddress?: string;
  /** 子女备注（女性成员用，简要标注子女情况） */
  childrenNote?: string;
  courtesy?: string;
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  occupation?: string;
  phone?: string;
  address?: string;
  bio?: string;
  avatar?: string;
  createdAt: number;
  updatedAt: number;
}

// ======================== LRU 缓存 ========================

class LRUCache<K, V> {
  private capacity: number;
  private cache = new Map<K, V>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// ======================== 内部状态 ========================

let encryptionKey: Buffer | null = null;
let indexMap = new Map<string, PersonIndex>();
let personOrder: string[] = []; // 有序 ID 列表，用于分片映射
const personCache = new LRUCache<string, Person>(LRU_CACHE_SIZE);

// ======================== 辅助函数 ========================

function requireKey(): Buffer {
  if (!encryptionKey) throw new Error('未登录，请先验证密码');
  return encryptionKey;
}

/** 从所有分片中收集指定 ID 的完整人员信息 */
function loadPersonFromDisk(id: string): Person | null {
  const key = requireKey();
  const idx = personOrder.indexOf(id);
  if (idx === -1) return null;
  const chunkId = getChunkId(idx);
  const chunkData = readChunk(chunkId, key);
  if (!chunkData) return null;
  return (chunkData[id] as Person) ?? null;
}

/** 保存索引到磁盘 */
function persistIndex(): void {
  const key = requireKey();
  const indexArray = Array.from(indexMap.values());
  writeIndex(indexArray, key);
}

/** 保存指定人员到对应分片 */
function persistPerson(person: Person): void {
  const key = requireKey();
  const idx = personOrder.indexOf(person.id);
  if (idx === -1) return;
  const chunkId = getChunkId(idx);

  // 读取现有分片数据
  let chunkData = readChunk(chunkId, key) ?? {};

  // 更新该人员
  chunkData[person.id] = person;
  writeChunk(chunkId, chunkData, key);
}

/** 从分片中删除人员 */
function removePersonFromChunk(id: string, idx: number): void {
  const key = requireKey();
  const chunkId = getChunkId(idx);
  const chunkData = readChunk(chunkId, key);
  if (chunkData) {
    delete chunkData[id];
    writeChunk(chunkId, chunkData, key);
  }
}

// ======================== 公共 API ========================

/**
 * 修复旧数据索引：扫描分片中的 biologicalParentId 和 spouseName，补全到索引中。
 * 仅在发现不一致时才写入磁盘，避免无谓 IO。
 */
function repairBiologicalParentIndex(): void {
  let needPersist = false;

  for (const [id, pi] of indexMap.entries()) {
    // 两个字段都已存在则跳过（注意：biologicalParentId 可能合法地为 null）
    const hasBio = pi.biologicalParentId !== undefined;
    const hasSpouse = pi.spouseName !== undefined;
    if (hasBio && hasSpouse) continue;

    // 从分片中读取完整数据
    const person = loadPersonFromDisk(id);
    if (!person) continue;

    let changed = false;
    if (!pi.biologicalParentId && person.biologicalParentId) {
      pi.biologicalParentId = person.biologicalParentId;
      changed = true;
    }
    if (pi.spouseName === undefined && person.spouseName) {
      pi.spouseName = person.spouseName;
      changed = true;
    }
    if (changed) {
      indexMap.set(id, pi);
      needPersist = true;
    }
  }

  if (needPersist) {
    persistIndex();
  }
}

/** 检查是否已初始化（是否有 config.json） */
export function isInitialized(): boolean {
  const config = readConfig();
  return config !== null && config.passwordHash !== undefined;
}

/** 检查是否已登录 */
export function isLoggedIn(): boolean {
  return encryptionKey !== null;
}

/** 首次设置密码 */
export function setupPassword(password: string): void {
  if (isInitialized()) {
    throw new Error('密码已设置，不可重复初始化');
  }
  ensureDataDir();

  const { hash, salt } = hashPassword(password);
  const keySalt = Buffer.from(salt, 'hex');
  encryptionKey = deriveKey(password, keySalt);

  writeConfig({
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  });

  // 写入空索引
  indexMap.clear();
  personOrder = [];
  persistIndex();
}

/** 验证密码并初始化 */
export function initialize(password: string): boolean {
  const config = readConfig();
  if (!config) throw new Error('尚未初始化，请先设置密码');

  const hash = config.passwordHash as string;
  const salt = config.passwordSalt as string;

  if (!verifyPwd(password, hash, salt)) {
    return false;
  }

  // 派生加密密钥
  encryptionKey = deriveKey(password, Buffer.from(salt, 'hex'));

  // 加载索引到内存
  const indexArray = readIndex(encryptionKey);
  indexMap.clear();
  personOrder = [];
  personCache.clear();

  if (indexArray && Array.isArray(indexArray)) {
    for (const item of indexArray) {
      const pi = item as PersonIndex;
      indexMap.set(pi.id, pi);
      personOrder.push(pi.id);
    }
  }

  // 修复旧数据：补全索引中缺失的 biologicalParentId
  repairBiologicalParentIndex();

  return true;
}

/** 验证密码（不初始化） */
export function verifyPassword(password: string): boolean {
  const config = readConfig();
  if (!config) return false;
  return verifyPwd(
    password,
    config.passwordHash as string,
    config.passwordSalt as string
  );
}

/** 计算同辈内下一个可用的 sortOrder（包含亲生但被过继出去的子女） */
function getNextSiblingOrder(parentId: string | null): number {
  if (!parentId) {
    // 根节点：在所有根节点中取最大 sortOrder + 1
    let max = 0;
    for (const pi of indexMap.values()) {
      if (!pi.parentId && pi.sortOrder > max) max = pi.sortOrder;
    }
    return max + 1;
  }
  // 同父节点中取最大 sortOrder + 1（包括亲生但被过继出去的子女）
  let max = 0;
  for (const pi of indexMap.values()) {
    if (pi.parentId === parentId && pi.sortOrder > max) max = pi.sortOrder;
    if (pi.biologicalParentId === parentId && pi.parentId !== parentId && pi.sortOrder > max) max = pi.sortOrder;
  }
  return max + 1;
}

/** 新增人员 */
export function createPerson(
  data: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>
): Person {
  requireKey();

  const now = Date.now();
  // 如果没有指定 sortOrder 或者传入 0，则自动计算同辈内的下一个排序值
  const autoSortOrder = (data.sortOrder === undefined || data.sortOrder === 0)
    ? getNextSiblingOrder(data.parentId)
    : data.sortOrder;

  const person: Person = {
    ...data,
    id: uuidv4(),
    sortOrder: autoSortOrder,
    createdAt: now,
    updatedAt: now,
  };

  // 更新索引
  const pi: PersonIndex = {
    id: person.id,
    name: person.name,
    gender: person.gender,
    generation: person.generation,
    parentId: person.parentId,
    biologicalParentId: person.biologicalParentId || null,
    spouseName: person.spouseName || undefined,
    sortOrder: person.sortOrder,
  };
  indexMap.set(person.id, pi);
  personOrder.push(person.id);

  // 持久化
  persistIndex();
  persistPerson(person);
  personCache.set(person.id, person);

  return person;
}

/** 更新人员 */
export function updatePerson(
  id: string,
  data: Partial<Omit<Person, 'id' | 'createdAt'>>
): Person {
  requireKey();

  const existing = getPerson(id);
  if (!existing) throw new Error(`人员不存在: ${id}`);

  const updated: Person = {
    ...existing,
    ...data,
    id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  // 更新索引
  const pi: PersonIndex = {
    id: updated.id,
    name: updated.name,
    gender: updated.gender,
    generation: updated.generation,
    parentId: updated.parentId,
    biologicalParentId: updated.biologicalParentId || null,
    spouseName: updated.spouseName || undefined,
    sortOrder: updated.sortOrder,
  };
  indexMap.set(id, pi);

  // 持久化
  persistIndex();
  persistPerson(updated);
  personCache.set(id, updated);

  return updated;
}

/** 删除人员（同时处理子节点：将子节点的 parentId 设为被删除人的 parentId） */
export function deletePerson(id: string): void {
  requireKey();

  const pi = indexMap.get(id);
  if (!pi) throw new Error(`人员不存在: ${id}`);

  // 处理子节点：将子节点挂到被删除人员的父节点下
  for (const [childId, childPi] of indexMap.entries()) {
    if (childPi.parentId === id) {
      childPi.parentId = pi.parentId;
      indexMap.set(childId, childPi);

      // 同时更新分片中的详情数据
      const childPerson = loadPersonFromDisk(childId);
      if (childPerson) {
        childPerson.parentId = pi.parentId;
        childPerson.updatedAt = Date.now();
        persistPerson(childPerson);
        personCache.delete(childId);
      }
    }
  }

  // 从分片中删除
  const idx = personOrder.indexOf(id);
  if (idx !== -1) {
    removePersonFromChunk(id, idx);
    personOrder.splice(idx, 1);
  }

  // 从索引中删除
  indexMap.delete(id);
  personCache.delete(id);
  persistIndex();
}

/** 获取完整人员信息（带 LRU 缓存） */
export function getPerson(id: string): Person | null {
  requireKey();

  const cached = personCache.get(id);
  if (cached) return cached;

  const person = loadPersonFromDisk(id);
  if (person) {
    personCache.set(id, person);
  }
  return person;
}

/** 列表查询（支持搜索、筛选、分页） */
export function listPersons(query?: {
  search?: string;
  gender?: 'male' | 'female';
  generation?: number;
  page?: number;
  pageSize?: number;
}): { items: PersonIndex[]; total: number } {
  let items = Array.from(indexMap.values());

  // 搜索过滤
  if (query?.search) {
    const keyword = query.search.toLowerCase();
    items = items.filter((p) => p.name.toLowerCase().includes(keyword));
  }

  // 性别筛选
  if (query?.gender) {
    items = items.filter((p) => p.gender === query.gender);
  }

  // 按世数筛选
  if (query?.generation !== undefined) {
    items = items.filter((p) => p.generation === query.generation);
  }

  // 排序
  items.sort((a, b) => a.sortOrder - b.sortOrder);

  const total = items.length;

  // 分页
  if (query?.page !== undefined && query?.pageSize !== undefined) {
    const start = (query.page - 1) * query.pageSize;
    items = items.slice(start, start + query.pageSize);
  }

  return { items, total };
}

/** 获取完整索引数组（用于树形渲染） */
export function getTreeData(): PersonIndex[] {
  return Array.from(indexMap.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
}

/** 获取某父亲的所有子女索引（按 sortOrder 排序） */
export function getChildren(parentId: string): PersonIndex[] {
  const children: PersonIndex[] = [];
  for (const pi of indexMap.values()) {
    if (pi.parentId === parentId) {
      children.push(pi);
    }
  }
  return children.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 批量更新子女排序（拖拽排序后调用） */
export function reorderChildren(parentId: string, orderedIds: string[]): void {
  requireKey();

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const pi = indexMap.get(id);
    if (pi && pi.parentId === parentId) {
      pi.sortOrder = i + 1;
      indexMap.set(id, pi);

      // 同步更新分片中的 sortOrder
      const person = loadPersonFromDisk(id);
      if (person) {
        person.sortOrder = i + 1;
        person.updatedAt = Date.now();
        persistPerson(person);
        personCache.delete(id);
      }
    }
  }

  persistIndex();
}

/** 导出明文数据 */
export function exportData(): Person[] {
  requireKey();

  const persons: Person[] = [];

  for (const id of personOrder) {
    const person = getPerson(id);
    if (person) persons.push(person);
  }

  return persons;
}

/** 导入明文数据 */
export function importData(persons: Person[]): void {
  requireKey();

  // 重建索引
  indexMap.clear();
  personOrder = [];
  personCache.clear();

  for (const person of persons) {
    const pi: PersonIndex = {
      id: person.id,
      name: person.name,
      gender: person.gender,
      generation: person.generation,
      parentId: person.parentId,
      biologicalParentId: person.biologicalParentId || null,
      spouseName: person.spouseName || undefined,
      sortOrder: person.sortOrder,
    };
    indexMap.set(pi.id, pi);
    personOrder.push(pi.id);
  }

  // 写入索引
  persistIndex();

  // 按分片写入详情数据
  const chunks = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < persons.length; i++) {
    const person = persons[i];
    const idx = personOrder.indexOf(person.id);
    if (idx === -1) continue;
    const chunkId = getChunkId(idx);
    if (!chunks.has(chunkId)) {
      chunks.set(chunkId, {});
    }
    chunks.get(chunkId)![person.id] = person;
  }

  const key = requireKey();
  for (const [chunkId, chunkData] of chunks.entries()) {
    writeChunk(chunkId, chunkData, key);
  }
}

/** 清除所有家族数据（保留密码配置） */
export function clearAllData(): void {
  requireKey();

  // 清除内存
  indexMap.clear();
  personOrder = [];
  personCache.clear();

  // 写入空索引
  persistIndex();

  // 删除所有分片文件
  clearChunks();
}

/** 创建备份 */
export function backup(): string {
  const key = requireKey();
  return createFileBackup(key);
}

// ======================== 辈分字（字辈）管理 ========================

/** 获取辈分字配置：{ poem?: string, characters: Record<number, string> } */
export function getGenerationChars(): { poem?: string; characters: Record<number, string> } {
  const key = requireKey();
  const meta = readFamilyMeta(key);
  if (!meta) return { characters: {} };
  return {
    poem: (meta.generationPoem as string) || undefined,
    characters: (meta.generationChars as Record<number, string>) || {},
  };
}

/** 保存辈分字配置 */
export function saveGenerationChars(data: { poem?: string; characters: Record<number, string> }): void {
  const key = requireKey();
  // 读取现有元数据，合并更新（保留其他字段）
  const existing = readFamilyMeta(key) || {};
  existing.generationPoem = data.poem || '';
  existing.generationChars = data.characters || {};
  writeFamilyMeta(existing, key);
}
