import type { PersonIndex } from '../types/person';

/**
 * 中文排行映射
 * 1→长, 2→次, 3→三, 4→四, ...
 */
const ORDER_NAMES = ['长', '次', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * 获取排行前缀（长/次/三/四...）
 */
function getOrderPrefix(n: number): string {
  if (n <= 0) return '';
  if (n <= ORDER_NAMES.length) return ORDER_NAMES[n - 1];
  return `${n}`;
}

/**
 * 获取统一排行名称（老大、老二、老三...）
 */
const UNIFIED_NAMES = ['老大', '老二', '老三', '老四', '老五', '老六', '老七', '老八', '老九', '老十'];

function getUnifiedOrderName(n: number): string {
  if (n <= 0) return '';
  if (n <= UNIFIED_NAMES.length) return UNIFIED_NAMES[n - 1];
  return `老${n}`;
}

/**
 * 获取分性别排行标签
 * 如: "长子", "次女", "三子"
 */
export function getGenderedOrderLabel(order: number, gender: 'male' | 'female'): string {
  if (order <= 0) return '';
  const prefix = getOrderPrefix(order);
  const suffix = gender === 'male' ? '子' : '女';
  return `${prefix}${suffix}`;
}

/**
 * 获取统一排行标签
 * 如: "老大", "老二", "老三"
 */
export function getUnifiedOrderLabel(order: number): string {
  if (order <= 0) return '';
  return getUnifiedOrderName(order);
}

/**
 * 排行信息
 */
export interface BirthOrderInfo {
  /** 统一排行（不分性别，在所有兄弟姐妹中的序号），1-based */
  unifiedOrder: number;
  /** 分性别排行（在同性别兄弟/姐妹中的序号），1-based */
  genderedOrder: number;
  /** 统一排行标签，如 "老大" */
  unifiedLabel: string;
  /** 分性别排行标签，如 "长子"、"次女" */
  genderedLabel: string;
  /** 同父兄弟姐妹总数 */
  totalSiblings: number;
  /** 同父同性别兄弟/姐妹总数 */
  totalSameGender: number;
}

/**
 * 排行上下文：
 * - 'biological': 按亲生父亲计算排行（包含被过继出去的亲生子女）
 * - 'adoptive': 按养父（parentId）计算排行（只看 parentId 相同的子女）
 * - 'auto': 自动判断——如果是被过继的人，按养父计算；否则按亲生父亲计算
 */
export type BirthOrderContext = 'biological' | 'adoptive' | 'auto';

/**
 * 获取某人的亲生父亲 ID
 * - 如果有 biologicalParentId（被过继出去），亲生父亲是 biologicalParentId
 * - 否则亲生父亲就是 parentId
 */
function getBiologicalParentId(person: PersonIndex): string | null {
  return person.biologicalParentId || person.parentId;
}

/**
 * 获取某个父亲的所有亲生子女（包括被过继出去的子女）
 * 亲生子女的定义：
 *   1. parentId === fatherId 且没有 biologicalParentId（未被过继，正常子女）
 *   2. parentId === fatherId 且 biologicalParentId === fatherId（biologicalParentId 和 parentId 相同，也是亲生）
 *   3. biologicalParentId === fatherId 且 parentId !== fatherId（被过继出去的子女）
 */
function getBiologicalChildren(fatherId: string, allPersons: PersonIndex[]): PersonIndex[] {
  return allPersons.filter((p) => {
    if (p.biologicalParentId && p.biologicalParentId === fatherId) {
      // 有 biologicalParentId 且指向此父亲 → 是其亲生子女（无论是否过继出去）
      return true;
    }
    if (p.parentId === fatherId && !p.biologicalParentId) {
      // parentId 指向此父亲且没有 biologicalParentId → 正常的亲生子女
      return true;
    }
    return false;
  });
}

/**
 * 获取某个父亲的所有直系子女（仅按 parentId 匹配，不含过继出去的亲生子女）
 */
function getDirectChildren(fatherId: string, allPersons: PersonIndex[]): PersonIndex[] {
  return allPersons.filter((p) => p.parentId === fatherId);
}

/**
 * 计算指定人员的排行信息
 *
 * @param personId 目标人员 ID
 * @param allPersons 所有人员索引
 * @param context 排行上下文（默认 'auto'）：
 *   - 'biological': 始终按亲生父亲的所有亲生子女来计算排行
 *   - 'adoptive': 始终按养父（parentId）的直系子女来计算排行
 *   - 'auto': 自动判断——被过继的人按养父计算，未过继的人按亲生父亲计算
 *
 * 举例：父亲A有三个亲生子女——甲（老大）、乙（过继给B，B还有亲生子丙）、丁（老三）
 * - context='biological': 乙在A这边排行老二
 * - context='adoptive': 乙在B这边的排行取决于乙在B的子女中的 sortOrder 位置
 * - context='auto': 乙自动按养父B的子女计算排行
 *
 * @returns 排行信息，如果没有父节点则返回 null
 */
export function getBirthOrderInfo(
  personId: string,
  allPersons: PersonIndex[],
  context: BirthOrderContext = 'auto',
): BirthOrderInfo | null {
  const person = allPersons.find((p) => p.id === personId);
  if (!person) return null;

  const isAdopted = !!person.biologicalParentId && person.biologicalParentId !== person.parentId;

  let siblings: PersonIndex[];

  if (context === 'biological') {
    // 始终按亲生父亲计算
    const bioParentId = getBiologicalParentId(person);
    if (!bioParentId) return null;
    siblings = getBiologicalChildren(bioParentId, allPersons);
  } else if (context === 'adoptive') {
    // 始终按养父（parentId）计算
    if (!person.parentId) return null;
    siblings = getDirectChildren(person.parentId, allPersons);
  } else {
    // 'auto': 被过继的人按养父，未过继的人按亲生父亲
    if (isAdopted) {
      // 被过继出去 → 按养父的直系子女计算
      if (!person.parentId) return null;
      siblings = getDirectChildren(person.parentId, allPersons);
    } else {
      // 未过继 → 按亲生父亲的所有亲生子女计算（包含被过继出去的兄弟姐妹）
      const bioParentId = getBiologicalParentId(person);
      if (!bioParentId) return null;
      siblings = getBiologicalChildren(bioParentId, allPersons);
    }
  }

  // 按 sortOrder 排序
  siblings.sort((a, b) => a.sortOrder - b.sortOrder);

  if (siblings.length === 0) return null;

  // 统一排行：在所有兄弟姐妹中的位置
  const unifiedOrder = siblings.findIndex((p) => p.id === personId) + 1;
  if (unifiedOrder === 0) return null; // 未找到自己（数据异常）

  // 分性别排行：在同性别兄弟/姐妹中的位置
  const sameGenderSiblings = siblings.filter((p) => p.gender === person.gender);
  const genderedOrder = sameGenderSiblings.findIndex((p) => p.id === personId) + 1;

  return {
    unifiedOrder,
    genderedOrder,
    unifiedLabel: getUnifiedOrderLabel(unifiedOrder),
    genderedLabel: getGenderedOrderLabel(genderedOrder, person.gender),
    totalSiblings: siblings.length,
    totalSameGender: sameGenderSiblings.length,
  };
}

/**
 * 批量计算所有人员的排行信息
 * @param allPersons 所有人员索引
 * @param context 排行上下文（默认 'auto'）
 * @returns Map<personId, BirthOrderInfo>
 */
export function getAllBirthOrderInfo(
  allPersons: PersonIndex[],
  context: BirthOrderContext = 'auto',
): Map<string, BirthOrderInfo> {
  const result = new Map<string, BirthOrderInfo>();

  for (const person of allPersons) {
    if (!person.parentId) continue;
    const info = getBirthOrderInfo(person.id, allPersons, context);
    if (info) {
      result.set(person.id, info);
    }
  }

  return result;
}

/**
 * 获取某父亲下一个新子女的推荐 sortOrder
 * 考虑亲生子女（包括被过继出去的），确保不会和已有子女的 sortOrder 冲突
 * @param parentId 父亲 ID
 * @param allPersons 所有人员索引
 * @returns 推荐的 sortOrder 值
 */
export function getNextSortOrder(
  parentId: string,
  allPersons: PersonIndex[],
): number {
  // 获取所有亲生子女（包括过继出去的）和养子女
  const allChildren = allPersons.filter((p) => {
    // 直系子女（parentId 匹配）
    if (p.parentId === parentId) return true;
    // 亲生但被过继出去的子女（biologicalParentId 匹配但 parentId 不同）
    if (p.biologicalParentId === parentId && p.parentId !== parentId) return true;
    return false;
  });
  if (allChildren.length === 0) return 1;
  const maxOrder = Math.max(...allChildren.map((p) => p.sortOrder));
  return maxOrder + 1;
}
