import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/bridge';
import type { PersonIndex, TreeNode, AdoptionLink } from '../types/person';

function buildTree(items: PersonIndex[]): { roots: TreeNode[]; adoptionLinks: AdoptionLink[]; placeholderIds: string[] } {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const adoptionLinks: AdoptionLink[] = [];

  // 先建立所有节点
  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  // 找到所有真实数据中的最小世代（始祖世代）
  let minGeneration = Infinity;
  for (const item of items) {
    if (item.generation < minGeneration) {
      minGeneration = item.generation;
    }
  }
  if (!isFinite(minGeneration)) minGeneration = 1;

  // ====== 为没有父辈的非始祖成员创建占位祖先链 ======
  // 收集需要创建占位节点的"孤儿"（没有parentId且不是最小世代的人）
  const orphans: PersonIndex[] = [];
  for (const item of items) {
    if (!item.parentId && item.generation > minGeneration) {
      orphans.push(item);
    }
  }

  // 按 generation 分组孤儿，同一 generation 的共享同一条占位祖先链
  const orphansByGen = new Map<number, PersonIndex[]>();
  for (const orphan of orphans) {
    const gen = orphan.generation;
    if (!orphansByGen.has(gen)) {
      orphansByGen.set(gen, []);
    }
    orphansByGen.get(gen)!.push(orphan);
  }

  // 为每组孤儿创建从 minGeneration 到 (generation - 1) 的占位节点链
  // 不同 generation 的孤儿可以共享上层的占位节点
  const placeholderMap = new Map<number, TreeNode>(); // generation → 占位节点

  /** 获取或创建指定世代的占位节点 */
  function getOrCreatePlaceholder(gen: number): TreeNode {
    if (placeholderMap.has(gen)) return placeholderMap.get(gen)!;

    const placeholderId = `__placeholder__gen${gen}`;
    const placeholder: TreeNode = {
      id: placeholderId,
      name: '',
      gender: 'male',
      generation: gen,
      parentId: null,
      sortOrder: 999999, // 排在最后
      children: [],
    };
    map.set(placeholderId, placeholder);
    placeholderMap.set(gen, placeholder);

    // 如果这个占位节点的世代大于最小世代，则需要继续向上创建占位父节点
    if (gen > minGeneration) {
      const parentPlaceholder = getOrCreatePlaceholder(gen - 1);
      placeholder.parentId = parentPlaceholder.id;
      parentPlaceholder.children.push(placeholder);
    }

    return placeholder;
  }

  // 为每组孤儿创建其直接的占位父节点（generation - 1）
  for (const [gen, orphanGroup] of orphansByGen.entries()) {
    const parentPlaceholder = getOrCreatePlaceholder(gen - 1);
    for (const orphan of orphanGroup) {
      const node = map.get(orphan.id)!;
      // 将孤儿挂到占位父节点下（不修改原始数据的 parentId）
      parentPlaceholder.children.push(node);
    }
  }

  // 建立父子关系
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else if (item.generation <= minGeneration) {
      // 只有始祖世代的人才作为真正的根节点
      roots.push(node);
    }
    // 如果是孤儿（非始祖且无父节点），已经在上面挂到了占位节点下，不需要再 push 到 roots
    // 收集过继关系（生父 ≠ 养父 才绘制虚线）
    if (
      item.biologicalParentId &&
      item.biologicalParentId !== item.parentId &&
      map.has(item.biologicalParentId)
    ) {
      adoptionLinks.push({
        childId: item.id,
        biologicalParentId: item.biologicalParentId,
      });
    }
  }

  // 将最小世代的占位节点也加入根节点
  if (placeholderMap.has(minGeneration)) {
    roots.push(placeholderMap.get(minGeneration)!);
  }

  // 每个节点的 children 按 sortOrder 排序（同辈内排序）
  for (const node of map.values()) {
    if (node.children.length > 1) {
      node.children.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  }
  // 根节点也排序
  roots.sort((a, b) => a.sortOrder - b.sortOrder);

  return { roots, adoptionLinks, placeholderIds: Array.from(placeholderMap.values()).map(p => p.id) };
}

function collectIds(node: TreeNode, maxGen: number, result: Set<string>) {
  if (node.generation <= maxGen) {
    // 占位节点不加入展开集合（佚名默认折叠），但仍递归其子节点
    if (!node.id.startsWith('__placeholder__')) {
      result.add(node.id);
    }
    for (const child of node.children) {
      collectIds(child, maxGen, result);
    }
  }
}

/** 递归收集所有有子节点的节点 ID（排除占位节点） */
function collectAllExpandableIds(node: TreeNode, result: Set<string>) {
  if (node.children.length > 0) {
    // 占位节点不加入展开集合
    if (!node.id.startsWith('__placeholder__')) {
      result.add(node.id);
    }
    for (const child of node.children) {
      collectAllExpandableIds(child, result);
    }
  }
}

/** 收集某个节点及其所有子孙的 ID */
function collectDescendantIds(node: TreeNode, result: Set<string>) {
  result.add(node.id);
  for (const child of node.children) {
    collectDescendantIds(child, result);
  }
}

/** 在 treeRef 中根据 id 查找节点 */
function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/** 收集所有被锁定节点及其子孙的 ID 集合 */
function collectAllLockedNodeIds(tree: TreeNode[], lockedIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const lockedId of lockedIds) {
    const node = findNodeById(tree, lockedId);
    if (node) {
      collectDescendantIds(node, result);
    }
  }
  return result;
}

/**
 * 将 newIds 应用到 expandedIds，但保留被锁定区域内节点的原始状态
 * @param newIds 新的展开 ID 集合（全局操作想要设置的目标状态）
 * @param prevIds 当前的展开 ID 集合
 * @param protectedIds 需要保护的节点 ID 集合（锁定节点+子孙）
 */
function mergeWithProtection(
  newIds: Set<string>,
  prevIds: Set<string>,
  protectedIds: Set<string>,
): Set<string> {
  const result = new Set<string>();
  // 对于非保护区域的节点，使用 newIds
  for (const id of newIds) {
    if (!protectedIds.has(id)) {
      result.add(id);
    }
  }
  // 对于保护区域的节点，保留 prevIds 中的状态
  for (const id of protectedIds) {
    if (prevIds.has(id)) {
      result.add(id);
    }
  }
  return result;
}

function findNodeByName(nodes: TreeNode[], name: string): TreeNode | null {
  for (const node of nodes) {
    if (node.name.includes(name)) return node;
    const found = findNodeByName(node.children, name);
    if (found) return found;
  }
  return null;
}

export function useTreeData() {
  const [rawData, setRawData] = useState<PersonIndex[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [adoptionLinks, setAdoptionLinks] = useState<AdoptionLink[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 当前选中的节点 ID（点击节点时设置） */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 选中节点的所有祖先 ID 集合（用于高亮直系血脉） */
  const [ancestorIds, setAncestorIds] = useState<Set<string>>(new Set());
  const treeRef = useRef<TreeNode[]>([]);
  /** 所有占位节点的 ID，用于在展开操作中默认包含 */
  const placeholderIdsRef = useRef<string[]>([]);
  /** 被锁定的节点 ID 集合——锁定后该节点（及其子孙）的展开/折叠状态不受全局操作影响 */
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  /** 是否已完成首次加载 */
  const initializedRef = useRef(false);

  const fetchData = useCallback(async (silent = false) => {
    // silent=true 时不设置 loading 状态（用于编辑/添加/删除后的增量刷新，
    // 避免 loading=true 导致 TreePage 卸载 FamilyTree 组件，
    // 从而丢失 D3 zoom/pan 状态，引起视图跳转）。
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await api.tree.getData();
      setRawData(data);
      const { roots: tree, adoptionLinks: links, placeholderIds } = buildTree(data);
      setTreeData(tree);
      setAdoptionLinks(links);
      treeRef.current = tree;
      placeholderIdsRef.current = placeholderIds;

      // 构建一个占位节点 ID 的快速查找集
      const placeholderIdSet = new Set(placeholderIds);

      if (!initializedRef.current) {
        // 首次加载：默认展开前 3 世，但排除所有占位节点（佚名默认折叠）
        initializedRef.current = true;
        const ids = new Set<string>();
        for (const root of tree) {
          collectIds(root, 3, ids);
        }
        // 移除所有占位节点，使佚名默认折叠
        for (const pid of placeholderIds) {
          ids.delete(pid);
        }
        setExpandedIds(ids);
      } else {
        // 后续刷新（添加/编辑/删除后）：保留当前展开状态
        // 占位节点保持之前的展开/折叠状态，不强制展开
        setExpandedIds((prev) => {
          const next = new Set(prev);
          // 清理已不存在的占位节点 ID（旧的占位节点可能已经被新的替代）
          let changed = false;
          for (const id of prev) {
            if (id.startsWith('__placeholder__') && !placeholderIdSet.has(id)) {
              next.delete(id);
              changed = true;
            }
          }
          // 如果没有任何改变，返回原引用以避免不必要的重渲染
          return changed ? next : prev;
        });
      }
    } catch {
      // 数据为空时不报错
      setTreeData([]);
      setRawData([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const expandToGeneration = useCallback(
    (n: number) => {
      const newIds = new Set<string>();
      for (const root of treeRef.current) {
        collectIds(root, n, newIds);
      }
      // collectIds 已自动排除占位节点，此处保留占位节点当前的展开状态
      setExpandedIds((prev) => {
        for (const pid of placeholderIdsRef.current) {
          if (prev.has(pid)) newIds.add(pid);
        }
        const protectedIds = collectAllLockedNodeIds(treeRef.current, lockedIds);
        if (protectedIds.size === 0) return newIds;
        return mergeWithProtection(newIds, prev, protectedIds);
      });
    },
    [lockedIds],
  );

  const toggleNode = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const findNode = useCallback(
    (name: string): TreeNode | null => {
      const found = findNodeByName(treeRef.current, name);
      if (found) {
        setHighlightId(found.id);
        // 展开到该节点的所有祖先
        const ids = new Set(expandedIds);
        let parentId = found.parentId;
        while (parentId) {
          ids.add(parentId);
          const parent = rawData.find((p) => p.id === parentId);
          parentId = parent?.parentId || null;
        }
        setExpandedIds(ids);
      } else {
        setHighlightId(null);
      }
      return found;
    },
    [expandedIds, rawData],
  );

  const expandAll = useCallback(() => {
    const newIds = new Set<string>();
    for (const root of treeRef.current) {
      collectAllExpandableIds(root, newIds);
    }
    // collectAllExpandableIds 已自动排除占位节点，此处保留占位节点当前的展开状态
    setExpandedIds((prev) => {
      for (const pid of placeholderIdsRef.current) {
        if (prev.has(pid)) {
          newIds.add(pid);
        }
      }
      const protectedIds = collectAllLockedNodeIds(treeRef.current, lockedIds);
      if (protectedIds.size === 0) return newIds;
      return mergeWithProtection(newIds, prev, protectedIds);
    });
  }, [lockedIds]);

  /** 展开指定节点及其所有后代 */
  const expandDescendants = useCallback((id: string) => {
    const node = findNodeById(treeRef.current, id);
    if (!node) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      // 将该节点自身加入展开集
      next.add(id);
      // 递归收集所有有子节点的后代
      const descendantExpandable = new Set<string>();
      collectAllExpandableIds(node, descendantExpandable);
      for (const did of descendantExpandable) {
        next.add(did);
      }
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedIds((prev) => {
      const protectedIds = collectAllLockedNodeIds(treeRef.current, lockedIds);
      if (protectedIds.size === 0) return new Set<string>();
      return mergeWithProtection(new Set<string>(), prev, protectedIds);
    });
  }, [lockedIds]);

  const clearHighlight = useCallback(() => {
    setHighlightId(null);
  }, []);

  /** 计算某个节点的所有祖先 ID（向上追溯至始祖） */
  const getAncestorIds = useCallback((personId: string): Set<string> => {
    const ancestors = new Set<string>();
    let currentId: string | null = personId;
    
    while (currentId) {
      const person = rawData.find((p) => p.id === currentId);
      if (!person || !person.parentId) break;
      ancestors.add(person.parentId);
      currentId = person.parentId;
    }
    
    return ancestors;
  }, [rawData]);

  /** 选中某个节点，并高亮其所有直系祖先 */
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setAncestorIds(getAncestorIds(id));
    } else {
      setAncestorIds(new Set());
    }
  }, [getAncestorIds]);

  /** 清除选中状态和祖先高亮 */
  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setAncestorIds(new Set());
  }, []);

  /** 切换某个节点的锁定状态 */
  const toggleLock = useCallback((id: string) => {
    setLockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 解锁所有节点 */
  const unlockAll = useCallback(() => {
    setLockedIds(new Set());
  }, []);

  /** 刷新数据并确保指定节点处于展开状态（用于添加子女后保持父节点展开） */
  const refreshAndExpand = useCallback(async (nodeId?: string) => {
    if (nodeId) {
      // 先确保该节点在展开集中
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    }
    // 使用 silent 模式刷新，避免 loading 状态导致 FamilyTree 卸载重建
    await fetchData(true);
  }, [fetchData]);

  /** 静默刷新数据（不设置 loading 状态，用于编辑/删除后的增量刷新） */
  const silentRefresh = useCallback(() => fetchData(true), [fetchData]);

  return {
    treeData,
    rawData,
    adoptionLinks,
    expandedIds,
    lockedIds,
    loading,
    highlightId,
    selectedId,
    ancestorIds,
    expandToGeneration,
    expandAll,
    expandDescendants,
    collapseAll,
    toggleNode,
    toggleLock,
    unlockAll,
    findNode,
    clearHighlight,
    selectNode,
    clearSelection,
    refresh: fetchData,
    silentRefresh,
    refreshAndExpand,
  };
}
