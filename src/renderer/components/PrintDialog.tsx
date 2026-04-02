import React, { useState, useCallback, useMemo } from 'react';
import { Modal, Button, Select, Space, Divider, Checkbox, message, Spin, Radio, Tooltip } from 'antd';
import { PrinterOutlined, FilePdfOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { TreeNode, PersonIndex, Person } from '../types/person';
import { api } from '../api/bridge';
import { getGenerationColors, type GenerationColorItem } from '../utils/generationColors';

type PrintScope = 'all' | 'lineage';

interface PrintDialogProps {
  visible: boolean;
  onClose: () => void;
  treeData: TreeNode[];
  rawData: PersonIndex[];
  personDetailMap: Map<string, Person>;
  /** 当前选中的节点 ID（用于默认选择打印目标） */
  selectedId?: string | null;
}

// ============= 辅助工具 =============

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 将树扁平化为按世代分组的人员列表 */
function flattenByGeneration(nodes: TreeNode[]): Map<number, TreeNode[]> {
  const map = new Map<number, TreeNode[]>();
  const walk = (items: TreeNode[]) => {
    for (const node of items) {
      const gen = node.generation;
      if (!map.has(gen)) map.set(gen, []);
      map.get(gen)!.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return map;
}

/** 建立 id → 父节点id 映射 */
function buildParentMap(nodes: TreeNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const walk = (items: TreeNode[], parentId: string | null) => {
    for (const node of items) {
      map.set(node.id, parentId);
      if (node.children?.length) walk(node.children, node.id);
    }
  };
  walk(nodes, null);
  return map;
}

/** 从 rawData 中获取指定人物的所有直系祖先 ID */
function getAncestorIdsFromRaw(id: string, rawData: PersonIndex[]): Set<string> {
  const ancestors = new Set<string>();
  const personMap = new Map<string, PersonIndex>();
  for (const p of rawData) personMap.set(p.id, p);
  let currentId: string | null = id;
  while (currentId) {
    const person = personMap.get(currentId);
    if (!person || !person.parentId) break;
    ancestors.add(person.parentId);
    currentId = person.parentId;
  }
  return ancestors;
}

/** 从 rawData 中获取指定人物的所有后代 ID（纯粹基于 parentId，不受展开状态影响） */
function getAllDescendantIdsFromRaw(personId: string, rawData: PersonIndex[]): Set<string> {
  const childrenMap = new Map<string, string[]>();
  for (const p of rawData) {
    if (p.parentId) {
      if (!childrenMap.has(p.parentId)) childrenMap.set(p.parentId, []);
      childrenMap.get(p.parentId)!.push(p.id);
    }
  }
  const result = new Set<string>();
  const queue = [personId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) || [];
    for (const childId of children) {
      result.add(childId);
      queue.push(childId);
    }
  }
  return result;
}

/**
 * 从 rawData 构建仅包含直系血脉的 TreeNode[] 树
 * 包含：目标人物的所有直系祖先 + 自身 + 所有后代
 * 返回的 TreeNode[] 格式与 treeData 一致，可直接用于所有现有的打印渲染函数
 */
function buildLineageTreeData(targetId: string, rawData: PersonIndex[]): TreeNode[] {
  const personMap = new Map<string, PersonIndex>();
  for (const p of rawData) personMap.set(p.id, p);

  const target = personMap.get(targetId);
  if (!target) return [];

  const ancestorIds = getAncestorIdsFromRaw(targetId, rawData);
  const descendantIds = getAllDescendantIdsFromRaw(targetId, rawData);
  const keepIds = new Set<string>([targetId, ...ancestorIds, ...descendantIds]);

  // 建立 parentId → children 映射（只保留需要的人）
  const childrenMap = new Map<string, PersonIndex[]>();
  for (const p of rawData) {
    if (!keepIds.has(p.id)) continue;
    if (p.parentId && keepIds.has(p.parentId)) {
      if (!childrenMap.has(p.parentId)) childrenMap.set(p.parentId, []);
      childrenMap.get(p.parentId)!.push(p);
    }
  }

  // 对每组子节点按 sortOrder 排序
  for (const [, children] of childrenMap) {
    children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // 递归构建 TreeNode
  function buildNode(p: PersonIndex): TreeNode {
    const children = childrenMap.get(p.id) || [];
    return {
      id: p.id,
      name: p.name,
      gender: p.gender,
      generation: p.generation,
      spouseName: p.spouseName,
      children: children.map(buildNode),
    };
  }

  // 找到根节点：祖先链中最远的那个
  let rootId = targetId;
  let currentId: string | null = targetId;
  while (currentId) {
    const person = personMap.get(currentId);
    if (!person || !person.parentId || !keepIds.has(person.parentId)) {
      rootId = currentId;
      break;
    }
    rootId = person.parentId;
    currentId = person.parentId;
  }

  const rootPerson = personMap.get(rootId);
  if (!rootPerson) return [];

  return [buildNode(rootPerson)];
}

/** 递归收集指定世代范围内的树，并将 genStart 世代的节点提升为根节点 */
function filterTreeByGenRange(nodes: TreeNode[], genStart: number, genEnd: number): TreeNode[] {
  const result: TreeNode[] = [];

  function collect(items: TreeNode[]) {
    for (const node of items) {
      if (node.generation > genEnd) continue;

      if (node.generation >= genStart) {
        // 此节点在目标范围内，作为子树根节点保留（递归裁剪其后代）
        const filtered: TreeNode = {
          ...node,
          children: node.generation < genEnd && node.children?.length
            ? filterTreeByGenRange(node.children, genStart, genEnd)
            : [],
        };
        result.push(filtered);
      } else {
        // 此节点在 genStart 之前（祖先），穿透到其子节点继续查找
        if (node.children?.length) {
          collect(node.children);
        }
      }
    }
  }

  collect(nodes);
  return result;
}

/** 建立 id → TreeNode 的扁平映射 */
function buildNodeMap(nodes: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  const walk = (items: TreeNode[]) => {
    for (const n of items) {
      map.set(n.id, n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return map;
}

// ============================================================
// 苏式吊线图 —— 横排模式（现代风格）
// 树从上到下展开，姓名横排，吊线用竖线+横线绘制
// ============================================================

interface HLayoutNode {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  spouseName?: string;
  x: number;     // 节点中心 x
  y: number;     // 节点顶部 y
  w: number;     // 节点宽度
  h: number;     // 节点高度
  children: HLayoutNode[];
}

// 横排布局参数
const H_NODE_H = 30;        // 节点高度
const H_NODE_MIN_W = 56;    // 节点最小宽度
const H_CHAR_W = 14;        // 每个汉字的宽度
const H_PADDING_X = 12;     // 节点左右内边距
const H_SIBLING_GAP = 14;   // 同辈兄弟之间的间距
const H_GEN_GAP = 50;       // 世代之间垂直间距（包含吊线空间）
const H_SPOUSE_W = 48;      // 配偶框宽度
const H_SPOUSE_GAP = 4;     // 配偶框间距

function calcNodeW(name: string): number {
  return Math.max(H_NODE_MIN_W, name.length * H_CHAR_W + H_PADDING_X * 2);
}

/** 横排模式布局：自底向上分配 x 坐标 */
function hLayout(
  nodes: TreeNode[], startGen: number, endGen: number, includeSpouse: boolean,
): HLayoutNode[] {
  let nextX = 0;

  function layout(node: TreeNode): HLayoutNode | null {
    if (node.generation > endGen) return null;

    const children: HLayoutNode[] = [];
    if (node.children?.length && node.generation < endGen) {
      for (const child of node.children) {
        const lc = layout(child);
        if (lc) children.push(lc);
      }
    }

    const w = calcNodeW(node.name);
    const spW = includeSpouse && node.spouseName ? H_SPOUSE_W + H_SPOUSE_GAP : 0;
    const totalW = w + spW;
    const y = (node.generation - startGen) * (H_NODE_H + H_GEN_GAP);

    if (children.length === 0) {
      const x = nextX + totalW / 2;
      nextX += totalW + H_SIBLING_GAP;
      return {
        id: node.id, name: node.name, gender: node.gender,
        generation: node.generation, spouseName: node.spouseName,
        x, y, w, h: H_NODE_H, children,
      };
    } else {
      // 居中于子节点
      const leftX = children[0].x - children[0].w / 2;
      const rightX = children[children.length - 1].x + children[children.length - 1].w / 2;
      const childrenSpan = rightX - leftX;
      let x: number;

      if (totalW > childrenSpan) {
        // 父节点比所有子节点还宽——不太可能，但处理一下
        x = (leftX + rightX) / 2;
      } else {
        x = (children[0].x + children[children.length - 1].x) / 2;
      }

      // 确保不与左侧重叠
      const minX = nextX + totalW / 2;
      if (x < minX) {
        const shift = minX - x;
        // 右移所有子节点
        function shiftTree(n: HLayoutNode, dx: number) {
          n.x += dx;
          for (const c of n.children) shiftTree(c, dx);
        }
        for (const c of children) shiftTree(c, shift);
        x = minX;
      }

      nextX = Math.max(nextX, x + totalW / 2 + H_SIBLING_GAP);

      return {
        id: node.id, name: node.name, gender: node.gender,
        generation: node.generation, spouseName: node.spouseName,
        x, y, w, h: H_NODE_H, children,
      };
    }
  }

  const roots: HLayoutNode[] = [];
  for (const node of nodes) {
    if (node.generation >= startGen && node.generation <= endGen) {
      const ln = layout(node);
      if (ln) roots.push(ln);
    }
  }
  return roots;
}

/** 生成横排苏式吊线图 SVG */
function generateHorizontalSuSVG(
  roots: HLayoutNode[],
  detailMap: Map<string, Person>,
  genColors: GenerationColorItem[],
  startGen: number,
  endGen: number,
  includeSpouse: boolean,
  includeDetail: boolean,
): string {
  if (roots.length === 0) return '';

  const getColor = (gen: number): GenerationColorItem => {
    const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length;
    return genColors[idx];
  };

  // 收集所有节点
  const allNodes: HLayoutNode[] = [];
  function collectAll(node: HLayoutNode) {
    allNodes.push(node);
    for (const child of node.children) collectAll(child);
  }
  for (const root of roots) collectAll(root);
  if (allNodes.length === 0) return '';

  // 计算画布尺寸
  const spExtra = includeSpouse ? H_SPOUSE_W + H_SPOUSE_GAP : 0;
  const maxX = Math.max(...allNodes.map((n) => n.x + n.w / 2 + spExtra)) + 30;
  const maxGenOff = endGen - startGen;
  const totalH = (maxGenOff + 1) * (H_NODE_H + H_GEN_GAP);
  const pad = 30;
  const leftM = 50;
  const svgW = maxX + pad * 2 + leftM;
  const svgH = totalH + pad * 2 + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:'SimSun','宋体','Noto Serif SC',serif;">\n`;
  svg += `<rect width="100%" height="100%" fill="#fffef8"/>\n`;

  // 世代行背景和标签
  for (let gen = startGen; gen <= endGen; gen++) {
    const rowY = (gen - startGen) * (H_NODE_H + H_GEN_GAP) + pad;
    const rowH = H_NODE_H + H_GEN_GAP;
    const c = getColor(gen);
    if ((gen - startGen) % 2 === 0) {
      svg += `<rect x="0" y="${rowY - 6}" width="${svgW}" height="${rowH}" fill="${c.bg}" opacity="0.2" rx="2"/>\n`;
    }
    svg += `<rect x="4" y="${rowY}" width="36" height="${H_NODE_H}" rx="4" fill="${c.bg}" stroke="${c.border}" stroke-width="1"/>\n`;
    svg += `<text x="22" y="${rowY + H_NODE_H / 2 + 1}" font-size="12" font-weight="bold" fill="${c.text}" text-anchor="middle" dominant-baseline="central">${gen}世</text>\n`;
  }

  svg += `<g transform="translate(${pad + leftM}, ${pad})">\n`;

  // 递归绘制
  function drawNode(node: HLayoutNode) {
    const c = getColor(node.generation);
    const genderColor = node.gender === 'male' ? '#1677ff' : '#eb2f96';
    const detail = detailMap.get(node.id);

    const nx = node.x - node.w / 2;
    const ny = node.y;

    // ---- 吊线：从父节点底部中心出发 → 垂直向下 → 横线连接所有子节点 → 每个子节点垂直向下到子节点顶部 ----
    if (node.children.length > 0) {
      const parentBottomY = ny + H_NODE_H;
      const childTopY = node.children[0].y;
      // 横线 y 坐标：父底部和子顶部之间的中点
      const hookY = parentBottomY + (childTopY - parentBottomY) / 2;

      // 1. 父节点底部中心 → 竖线向下到横线
      svg += `<line x1="${node.x}" y1="${parentBottomY}" x2="${node.x}" y2="${hookY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;

      if (node.children.length === 1) {
        // 单子：直线连下去
        const child = node.children[0];
        svg += `<line x1="${node.x}" y1="${hookY}" x2="${child.x}" y2="${hookY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        svg += `<line x1="${child.x}" y1="${hookY}" x2="${child.x}" y2="${childTopY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
      } else {
        // 多子：横线连接左右最外侧的子节点
        const leftChildX = node.children[0].x;
        const rightChildX = node.children[node.children.length - 1].x;

        // 2. 横线
        svg += `<line x1="${leftChildX}" y1="${hookY}" x2="${rightChildX}" y2="${hookY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;

        // 如果父不在横线范围内，连个竖拐过去
        if (node.x < leftChildX || node.x > rightChildX) {
          const midX = (leftChildX + rightChildX) / 2;
          svg += `<line x1="${node.x}" y1="${hookY}" x2="${midX}" y2="${hookY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        }

        // 3. 每个子节点从横线垂直向下
        for (const child of node.children) {
          svg += `<line x1="${child.x}" y1="${hookY}" x2="${child.x}" y2="${childTopY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        }
      }

      // 吊线端点小圆点（传统装饰）
      svg += `<circle cx="${node.x}" cy="${parentBottomY}" r="2" fill="#5a3e28"/>\n`;
      for (const child of node.children) {
        svg += `<circle cx="${child.x}" cy="${childTopY}" r="2" fill="#5a3e28"/>\n`;
      }
    }

    // ---- 节点框 ----
    svg += `<rect x="${nx}" y="${ny}" width="${node.w}" height="${H_NODE_H}" rx="4" fill="${c.bg}" stroke="${c.border}" stroke-width="1.5"/>\n`;

    // 姓名（横排）
    const gSymbol = node.gender === 'male' ? '♂' : '♀';
    svg += `<text x="${node.x}" y="${ny + H_NODE_H / 2 + 1}" font-size="13" font-weight="bold" fill="${c.text}" text-anchor="middle" dominant-baseline="central">${escapeXml(node.name)}</text>\n`;
    // 性别符号
    svg += `<text x="${nx + node.w - 6}" y="${ny + 10}" font-size="8" fill="${genderColor}">${gSymbol}</text>\n`;

    // 配偶框
    if (includeSpouse && node.spouseName) {
      const spX = nx + node.w + H_SPOUSE_GAP;
      const spY = ny + 3;
      const spH = H_NODE_H - 6;
      svg += `<line x1="${nx + node.w}" y1="${ny + H_NODE_H / 2}" x2="${spX}" y2="${spY + spH / 2}" stroke="#d3adf7" stroke-width="1" stroke-dasharray="3,2"/>\n`;
      svg += `<rect x="${spX}" y="${spY}" width="${H_SPOUSE_W}" height="${spH}" rx="3" fill="#f8f4ff" stroke="#d3adf7" stroke-width="1" stroke-dasharray="3,2"/>\n`;
      const sn = node.spouseName.length > 3 ? node.spouseName.slice(0, 3) + '…' : node.spouseName;
      svg += `<text x="${spX + H_SPOUSE_W / 2}" y="${spY + spH / 2 + 1}" font-size="10" fill="#722ed1" text-anchor="middle" dominant-baseline="central">${escapeXml(sn)}</text>\n`;
    }

    // 简要旁注（节点正下方小字）
    if (includeDetail && detail) {
      const annotations: string[] = [];
      if (detail.birthDate) annotations.push(detail.birthDate);
      if (detail.birthPlace) annotations.push(detail.birthPlace.length > 6 ? detail.birthPlace.slice(0, 6) : detail.birthPlace);
      if (annotations.length > 0) {
        const annoText = annotations.join(' · ');
        svg += `<text x="${node.x}" y="${ny + H_NODE_H + 12}" font-size="8" fill="#999" text-anchor="middle">${escapeXml(annoText)}</text>\n`;
      }
    }

    // 递归子节点
    for (const child of node.children) {
      drawNode(child);
    }
  }

  for (const root of roots) drawNode(root);

  svg += `</g>\n`;

  // 底部图例
  const legendY = svgH - 16;
  svg += `<g transform="translate(${svgW / 2}, ${legendY})" text-anchor="middle">`;
  svg += `<text font-size="10" fill="#999">`;
  svg += `方框为族人 ━━ 横线连接同辈兄弟 ┃ 竖线为父子传承`;
  if (includeSpouse) svg += ` 虚线框为配偶`;
  svg += `</text></g>\n`;

  svg += `</svg>\n`;
  return svg;
}

// ============================================================
// 苏式吊线图 —— 竖排模式（传统风格）
// 阅读方向：从右到左（传统），姓名竖排，吊线竖横分明
// 每个世代占一列，从右往左排列（右为长辈，左为晚辈）
// ============================================================

interface VLayoutNode {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  spouseName?: string;
  x: number;     // 节点左上角 x（实际渲染时整体镜像翻转为从右到左）
  y: number;     // 节点顶部 y
  children: VLayoutNode[];
}

// 竖排布局参数
const V_CHAR_W = 18;        // 每个竖排汉字宽度
const V_CHAR_H = 20;        // 每个竖排汉字高度
const V_SIBLING_GAP = 20;   // 同辈人之间纵向间距
const V_GEN_GAP = 60;       // 世代之间水平间距（吊线区域）
const V_NAME_COL_W = 30;    // 名字列宽度

/** 计算竖排名字的高度 */
function vertNameH(name: string): number {
  return Math.max(name.length, 2) * V_CHAR_H + 8;
}

/** 竖排模式布局：世代从左到右（后续渲染时翻转为从右到左），人名从上到下 */
function vLayout(
  nodes: TreeNode[], startGen: number, endGen: number,
): VLayoutNode[] {
  let nextY = 0;

  function layout(node: TreeNode): VLayoutNode | null {
    if (node.generation > endGen) return null;

    const children: VLayoutNode[] = [];
    if (node.children?.length && node.generation < endGen) {
      for (const child of node.children) {
        const lc = layout(child);
        if (lc) children.push(lc);
      }
    }

    // x 坐标由世代决定
    const x = (node.generation - startGen) * (V_NAME_COL_W + V_GEN_GAP);
    const nameH = vertNameH(node.name);

    if (children.length === 0) {
      const y = nextY;
      nextY += nameH + V_SIBLING_GAP;
      return {
        id: node.id, name: node.name, gender: node.gender,
        generation: node.generation, spouseName: node.spouseName,
        x, y, children,
      };
    } else {
      // 父节点居中于子节点范围
      const topChildY = children[0].y;
      const bottomChildY = children[children.length - 1].y + vertNameH(children[children.length - 1].name);
      const childMidY = (topChildY + bottomChildY) / 2;
      const y = childMidY - nameH / 2;

      // 确保不与上方重叠
      const minY = nextY;
      if (y < minY) {
        const shift = minY - y;
        function shiftTree(n: VLayoutNode, dy: number) {
          n.y += dy;
          for (const c of n.children) shiftTree(c, dy);
        }
        for (const c of children) shiftTree(c, shift);
        // 重新居中
        const newTopY = children[0].y;
        const newBottomY = children[children.length - 1].y + vertNameH(children[children.length - 1].name);
        const newMidY = (newTopY + newBottomY) / 2;
        const adjustedY = newMidY - nameH / 2;
        nextY = Math.max(nextY, adjustedY + nameH + V_SIBLING_GAP);
        return {
          id: node.id, name: node.name, gender: node.gender,
          generation: node.generation, spouseName: node.spouseName,
          x, y: adjustedY, children,
        };
      }

      nextY = Math.max(nextY, y + nameH + V_SIBLING_GAP);
      return {
        id: node.id, name: node.name, gender: node.gender,
        generation: node.generation, spouseName: node.spouseName,
        x, y, children,
      };
    }
  }

  const roots: VLayoutNode[] = [];
  for (const node of nodes) {
    if (node.generation >= startGen && node.generation <= endGen) {
      const ln = layout(node);
      if (ln) roots.push(ln);
    }
  }
  return roots;
}

/** 生成竖排苏式吊线图 SVG（从右到左阅读） */
function generateVerticalSuSVG(
  roots: VLayoutNode[],
  detailMap: Map<string, Person>,
  genColors: GenerationColorItem[],
  startGen: number,
  endGen: number,
  includeSpouse: boolean,
  includeDetail: boolean,
): string {
  if (roots.length === 0) return '';

  const getColor = (gen: number): GenerationColorItem => {
    const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length;
    return genColors[idx];
  };

  // 收集所有节点
  const allNodes: VLayoutNode[] = [];
  function collectAll(node: VLayoutNode) {
    allNodes.push(node);
    for (const child of node.children) collectAll(child);
  }
  for (const root of roots) collectAll(root);
  if (allNodes.length === 0) return '';

  // 计算原始画布大小（布局坐标系 = 左到右）
  const maxLX = Math.max(...allNodes.map((n) => n.x)) + V_NAME_COL_W + V_GEN_GAP;
  const maxLY = Math.max(...allNodes.map((n) => n.y + vertNameH(n.name))) + 20;

  const pad = 40;
  const topM = 50; // 顶部留给世代标签
  const svgW = maxLX + pad * 2;
  const svgH = maxLY + pad + topM + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:'SimSun','宋体','Noto Serif SC',serif;">\n`;
  svg += `<rect width="100%" height="100%" fill="#fffef8"/>\n`;

  // 整体翻转：从右到左阅读 → 用 transform scale(-1,1) 镜像 x 轴
  // 但文字也需要再镜像回来，所以我们手动计算镜像坐标
  // 镜像 x: mirrorX = svgW - pad - x
  const mirrorX = (lx: number) => svgW - pad - lx;

  // 世代列标签（顶部）
  for (let gen = startGen; gen <= endGen; gen++) {
    const colLX = (gen - startGen) * (V_NAME_COL_W + V_GEN_GAP) + V_NAME_COL_W / 2;
    const colMX = mirrorX(colLX);
    const c = getColor(gen);

    // 列背景
    const colLeft = mirrorX((gen - startGen) * (V_NAME_COL_W + V_GEN_GAP) + V_NAME_COL_W + V_GEN_GAP / 2);
    const colRight = mirrorX((gen - startGen) * (V_NAME_COL_W + V_GEN_GAP) - V_GEN_GAP / 2);
    const colW = colRight - colLeft;
    if ((gen - startGen) % 2 === 0) {
      svg += `<rect x="${colLeft}" y="0" width="${colW}" height="${svgH}" fill="${c.bg}" opacity="0.15"/>\n`;
    }

    // 世代标签
    svg += `<rect x="${colMX - 22}" y="6" width="44" height="26" rx="4" fill="${c.bg}" stroke="${c.border}" stroke-width="1"/>\n`;
    svg += `<text x="${colMX}" y="20" font-size="13" font-weight="bold" fill="${c.text}" text-anchor="middle" dominant-baseline="central">第${gen}世</text>\n`;
  }

  // 递归绘制
  function drawNode(node: VLayoutNode) {
    const c = getColor(node.generation);
    const genderColor = node.gender === 'male' ? '#1677ff' : '#eb2f96';
    const nameH = vertNameH(node.name);
    const detail = detailMap.get(node.id);

    // 镜像坐标
    const nx = mirrorX(node.x + V_NAME_COL_W); // 名字框左上角 x
    const ny = node.y + topM;

    // ---- 吊线 ----
    if (node.children.length > 0) {
      // 父节点右边缘中点（镜像后变成左边缘）
      const parentRightX = mirrorX(node.x + V_NAME_COL_W); // 镜像后这是左边
      const parentLeftX = mirrorX(node.x); // 镜像后这是右边
      const parentMidY = ny + nameH / 2;

      // 吊线的横杠 x：在父和子之间
      const childColLX = (node.generation + 1 - startGen) * (V_NAME_COL_W + V_GEN_GAP);
      const hookX = mirrorX(node.x + V_NAME_COL_W + V_GEN_GAP / 2);

      // 1. 父节点 → 横向到 hookX
      svg += `<line x1="${parentRightX}" y1="${parentMidY}" x2="${hookX}" y2="${parentMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
      svg += `<circle cx="${parentRightX}" cy="${parentMidY}" r="2" fill="#5a3e28"/>\n`;

      if (node.children.length === 1) {
        const child = node.children[0];
        const childNY = child.y + topM;
        const childNameH = vertNameH(child.name);
        const childMidY = childNY + childNameH / 2;
        const childRightX = mirrorX(child.x);

        // 竖线 + 横线连到子节点
        svg += `<line x1="${hookX}" y1="${parentMidY}" x2="${hookX}" y2="${childMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        svg += `<line x1="${hookX}" y1="${childMidY}" x2="${childRightX}" y2="${childMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        svg += `<circle cx="${childRightX}" cy="${childMidY}" r="2" fill="#5a3e28"/>\n`;
      } else {
        // 多个子节点
        const firstChild = node.children[0];
        const lastChild = node.children[node.children.length - 1];
        const firstChildMidY = firstChild.y + topM + vertNameH(firstChild.name) / 2;
        const lastChildMidY = lastChild.y + topM + vertNameH(lastChild.name) / 2;

        // 2. 竖线（从第一个子到最后一个子的 y 范围）
        svg += `<line x1="${hookX}" y1="${firstChildMidY}" x2="${hookX}" y2="${lastChildMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;

        // 父到竖线
        if (parentMidY < firstChildMidY) {
          svg += `<line x1="${hookX}" y1="${parentMidY}" x2="${hookX}" y2="${firstChildMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        } else if (parentMidY > lastChildMidY) {
          svg += `<line x1="${hookX}" y1="${lastChildMidY}" x2="${hookX}" y2="${parentMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
        }
        // 否则父已在竖线范围内

        // 3. 每个子节点的横线
        for (const child of node.children) {
          const childNY = child.y + topM;
          const childNameH2 = vertNameH(child.name);
          const childMidY = childNY + childNameH2 / 2;
          const childRightX = mirrorX(child.x);

          svg += `<line x1="${hookX}" y1="${childMidY}" x2="${childRightX}" y2="${childMidY}" stroke="#5a3e28" stroke-width="1.5"/>\n`;
          svg += `<circle cx="${childRightX}" cy="${childMidY}" r="2" fill="#5a3e28"/>\n`;
        }
      }
    }

    // ---- 名字框 ----
    svg += `<rect x="${nx}" y="${ny}" width="${V_NAME_COL_W}" height="${nameH}" rx="3" fill="${c.bg}" stroke="${c.border}" stroke-width="1.5"/>\n`;

    // 竖排文字
    for (let ci = 0; ci < node.name.length; ci++) {
      svg += `<text x="${nx + V_NAME_COL_W / 2}" y="${ny + 16 + ci * V_CHAR_H}" font-size="15" font-weight="bold" fill="${c.text}" text-anchor="middle" dominant-baseline="central">${escapeXml(node.name[ci])}</text>\n`;
    }

    // 性别符号
    const gSymbol = node.gender === 'male' ? '♂' : '♀';
    svg += `<text x="${nx + V_NAME_COL_W - 2}" y="${ny + 10}" font-size="9" fill="${genderColor}">${gSymbol}</text>\n`;

    // 配偶（名字框左侧，竖排小字，传统族谱中配偶写在名字旁）
    if (includeSpouse && node.spouseName) {
      const spX = nx - 14;
      const spLabel = '配' + node.spouseName;
      for (let ci = 0; ci < spLabel.length && ci < 6; ci++) {
        svg += `<text x="${spX}" y="${ny + 12 + ci * 13}" font-size="10" fill="#722ed1" text-anchor="middle" dominant-baseline="central">${escapeXml(spLabel[ci])}</text>\n`;
      }
    }

    // 简要旁注（名字框右侧，竖排小字）
    if (includeDetail && detail) {
      const annotations: string[] = [];
      if (detail.birthDate) annotations.push(`生${detail.birthDate}`);
      if (detail.deathDate) annotations.push(`殁${detail.deathDate}`);
      if (detail.birthPlace) annotations.push(detail.birthPlace.length > 4 ? detail.birthPlace.slice(0, 4) : detail.birthPlace);

      if (annotations.length > 0) {
        const annoStr = annotations.join('');
        const annoX = nx + V_NAME_COL_W + 10;
        for (let ci = 0; ci < annoStr.length && ci < 12; ci++) {
          svg += `<text x="${annoX}" y="${ny + 10 + ci * 11}" font-size="8" fill="#aaa" text-anchor="start" dominant-baseline="central">${escapeXml(annoStr[ci])}</text>\n`;
        }
      }
    }

    // 递归子节点
    for (const child of node.children) drawNode(child);
  }

  for (const root of roots) drawNode(root);

  // 底部图例
  const legendY = svgH - 14;
  svg += `<text x="${svgW / 2}" y="${legendY}" font-size="10" fill="#999" text-anchor="middle">`;
  svg += `阅读方向：从右往左 → 右侧为长辈，左侧为晚辈 ┃ 竖线连接同辈 ━ 横线为父子传承`;
  if (includeSpouse) svg += ` 紫色小字为配偶`;
  svg += `</text>\n`;

  svg += `</svg>\n`;
  return svg;
}

// ============= 打印样式 & 选项 =============

/** 打印样式 */
type PrintStyle = 'su-style' | 'tree-style' | 'table-style';
/** 苏式排列方向 */
type SuDirection = 'horizontal' | 'vertical';

const PrintDialog: React.FC<PrintDialogProps> = ({
  visible,
  onClose,
  treeData,
  rawData,
  personDetailMap: propDetailMap,
  selectedId,
}) => {
  const [genStart, setGenStart] = useState(1);
  const [genEnd, setGenEnd] = useState(5);
  const [includeDetail, setIncludeDetail] = useState(true);
  const [includeSpouse, setIncludeSpouse] = useState(true);
  const [includeBio, setIncludeBio] = useState(false);
  const [includeDetailPage, setIncludeDetailPage] = useState(true);
  const [printStyle, setPrintStyle] = useState<PrintStyle>('su-style');
  const [suDirection, setSuDirection] = useState<SuDirection>('horizontal');
  const [printing, setPrinting] = useState(false);
  const [personDetailMap, setPersonDetailMap] = useState<Map<string, Person>>(propDetailMap);
  const [printScope, setPrintScope] = useState<PrintScope>('all');
  const [targetPersonId, setTargetPersonId] = useState<string | null>(selectedId ?? null);

  // 当 selectedId 变化时同步更新 targetPersonId
  React.useEffect(() => {
    if (visible && selectedId) {
      setTargetPersonId(selectedId);
    }
  }, [visible, selectedId]);

  // 人员选项列表（用于搜索选择目标人物）
  const personOptions = useMemo(() => {
    return rawData
      .filter((p) => !p.id.startsWith('__placeholder__'))
      .map((p) => ({
        label: `${p.name}（第${p.generation}世）`,
        value: p.id,
      }));
  }, [rawData]);

  // 根据打印范围获取实际使用的树数据
  const effectiveTreeData = useMemo(() => {
    if (printScope === 'lineage' && targetPersonId) {
      return buildLineageTreeData(targetPersonId, rawData);
    }
    return treeData;
  }, [printScope, targetPersonId, rawData, treeData]);

  // 统计世代范围（基于 effectiveTreeData）
  const generationRange = useMemo(() => {
    const gens = new Set<number>();
    const walk = (items: TreeNode[]) => {
      for (const node of items) {
        gens.add(node.generation);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(effectiveTreeData);
    const arr = Array.from(gens).sort((a, b) => a - b);
    return { min: arr[0] || 1, max: arr[arr.length - 1] || 10, list: arr };
  }, [effectiveTreeData]);

  // 切换打印范围或目标人物时，自动调整世代范围
  React.useEffect(() => {
    if (generationRange.list.length > 0) {
      setGenStart(generationRange.min);
      setGenEnd(generationRange.max);
    }
  }, [generationRange.min, generationRange.max, generationRange.list.length]);

  const loadDetailMap = useCallback(async () => {
    if (propDetailMap.size > 0) {
      setPersonDetailMap(propDetailMap);
      return propDetailMap;
    }
    try {
      const persons = await api.data.export();
      const map = new Map<string, Person>();
      for (const p of persons) map.set(p.id, p);
      setPersonDetailMap(map);
      return map;
    } catch {
      message.error('加载人员数据失败');
      return new Map<string, Person>();
    }
  }, [propDetailMap]);

  const formatDate = (dateStr?: string): string => dateStr || '';

  // ============= 生成打印HTML =============
  const generatePrintHTML = useCallback(
    (detailMap: Map<string, Person>) => {
      const printData = effectiveTreeData;
      const genMap = flattenByGeneration(printData);
      const sortedGens = Array.from(genMap.keys())
        .sort((a, b) => a - b)
        .filter((g) => g >= genStart && g <= genEnd);
      const genColors = getGenerationColors();
      const getColor = (gen: number) => {
        const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length;
        return genColors[idx];
      };

      // 五世一图分段
      const GENS_PER_CHART = 5;
      const chartSections: { sGen: number; eGen: number; svg: string }[] = [];

      for (let sGen = genStart; sGen <= genEnd; sGen += GENS_PER_CHART - 1) {
        const eGen = Math.min(sGen + GENS_PER_CHART - 1, genEnd);
        if (eGen < sGen) break;

        const filteredTree = filterTreeByGenRange(printData, sGen, eGen);
        if (filteredTree.length > 0) {
          if (printStyle === 'su-style') {
            if (suDirection === 'horizontal') {
              const layoutRoots = hLayout(filteredTree, sGen, eGen, includeSpouse);
              const svg = generateHorizontalSuSVG(layoutRoots, detailMap, genColors, sGen, eGen, includeSpouse, includeDetail);
              if (svg) chartSections.push({ sGen, eGen, svg });
            } else {
              const layoutRoots = vLayout(filteredTree, sGen, eGen);
              const svg = generateVerticalSuSVG(layoutRoots, detailMap, genColors, sGen, eGen, includeSpouse, includeDetail);
              if (svg) chartSections.push({ sGen, eGen, svg });
            }
          } else if (printStyle === 'tree-style') {
            const layoutRoots = treeStyleLayout(filteredTree, sGen, eGen);
            const svg = generateTreeStyleSVG(layoutRoots, detailMap, genColors, sGen, eGen, includeSpouse);
            if (svg) chartSections.push({ sGen, eGen, svg });
          }
        }
        if (eGen >= genEnd) break;
      }

      // 欧式世系录 HTML
      let tableHTML = '';
      if (printStyle === 'table-style') {
        tableHTML = generateEuStyleTable(printData, detailMap, genColors, genStart, genEnd, includeSpouse, includeDetail);
      }

      const isVertical = printStyle === 'su-style' && suDirection === 'vertical';

      // ======== 组装完整 HTML ========
      let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<title>族谱 - 世系图册</title>
<style>
@page { size: ${isVertical ? 'A4 landscape' : 'A4'}; margin: 15mm 12mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: "SimSun","宋体","Noto Serif SC",serif;
  color: #333; line-height: 1.6; background: #fff;
}

/* 封面 */
.cover {
  page-break-after: always;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 90vh; text-align: center;
  border: 3px double #8b4513; padding: 50px 40px; margin: 20px 0;
}
.cover h1 { font-size: 42px; color: #8b4513; margin-bottom: 16px; letter-spacing: 12px; }
.cover .subtitle { font-size: 18px; color: #666; margin-bottom: 8px; }
.cover .gen-range {
  font-size: 16px; color: #8b4513; margin-top: 30px;
  padding: 10px 24px; border: 1px solid #d4a574; border-radius: 4px;
}
.cover .style-tag {
  font-size: 14px; color: #a0522d; margin-top: 16px;
  padding: 6px 16px; background: #fdf6ec; border-radius: 20px;
}
.cover .date { font-size: 14px; color: #999; margin-top: 40px; }

/* 凡例页 */
.legend-page {
  page-break-after: always; padding: 30px 20px;
}
.legend-page h2 {
  font-size: 22px; text-align: center; margin-bottom: 24px; color: #8b4513;
  border-bottom: 2px solid #d4a574; padding-bottom: 10px;
}
.legend-item {
  margin-bottom: 16px; font-size: 14px; line-height: 1.8;
}
.legend-item strong { color: #8b4513; }

/* 目录 */
.toc { page-break-after: always; padding: 20px 0; }
.toc h2 { font-size: 22px; text-align: center; margin-bottom: 20px; color: #8b4513; }
.toc-item {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 6px 0; border-bottom: 1px dotted #ddd; font-size: 15px;
}
.toc-item .gen-name { color: #333; font-weight: bold; }
.toc-item .person-count { color: #888; font-size: 13px; }

/* 图谱页 */
.chart-page { page-break-before: always; padding: 8px 0; }
.chart-header {
  background: linear-gradient(135deg, #8b4513, #a0522d); color: #fff;
  padding: 10px 20px; font-size: 17px; font-weight: bold;
  border-radius: 4px; margin-bottom: 12px; letter-spacing: 2px;
}
.chart-container {
  width: 100%; overflow-x: auto;
  border: 1px solid #e0d5c5; border-radius: 6px; padding: 8px;
  background: #fffef8; margin-bottom: 12px;
}
.chart-container svg { max-width: 100%; height: auto; }
.chart-note {
  text-align: center; font-size: 11px; color: #999; margin-top: 6px;
}

/* 欧式世系录表格 */
.eu-table-page { page-break-before: always; }
.eu-table {
  width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;
}
.eu-table th {
  background: #f5efe6; color: #8b4513; padding: 8px 6px;
  border: 1px solid #d4a574; font-weight: bold; text-align: center;
  white-space: nowrap;
}
.eu-table td {
  padding: 6px 8px; border: 1px solid #ddd; vertical-align: top;
}
.eu-table tr:nth-child(even) { background: #fdfbf5; }
.eu-name-cell { font-weight: bold; white-space: nowrap; }
.eu-gender-m { color: #1677ff; }
.eu-gender-f { color: #eb2f96; }
.eu-detail { font-size: 11px; color: #666; line-height: 1.6; }
.eu-spouse { font-size: 11px; color: #722ed1; }
.eu-children { font-size: 11px; color: #555; }

/* 世系录详情页 */
.gen-page { page-break-before: always; }
.gen-header {
  background: linear-gradient(135deg, #8b4513, #a0522d); color: #fff;
  padding: 10px 20px; font-size: 17px; font-weight: bold;
  border-radius: 4px; margin-bottom: 14px; letter-spacing: 3px;
}
.person-record {
  border-bottom: 1px solid #e8e0d5; padding: 10px 0; page-break-inside: avoid;
  display: flex; gap: 12px;
}
.person-record:last-child { border-bottom: none; }
.record-order {
  flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: bold; color: #fff; margin-top: 2px;
}
.record-body { flex: 1; }
.record-name-line {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 4px;
}
.record-name { font-size: 15px; font-weight: bold; color: #333; }
.record-tag {
  font-size: 11px; padding: 1px 6px; border-radius: 3px; color: #fff;
}
.record-tag.male { background: #1677ff; }
.record-tag.female { background: #eb2f96; }
.record-courtesy { font-size: 12px; color: #8b4513; }
.record-parent { font-size: 12px; color: #888; }
.record-detail {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 3px 12px; font-size: 12px; color: #555; margin-top: 4px;
}
.record-detail .dl { display: flex; gap: 2px; }
.record-detail .dl-label { color: #999; flex-shrink: 0; }
.record-bio {
  margin-top: 6px; padding: 6px 10px; background: #f9f6f0;
  border-left: 3px solid #d4a574; font-size: 12px; color: #555; line-height: 1.8;
}
.record-spouse {
  margin-top: 5px; padding: 4px 10px;
  background: #f8f4ff; border-left: 3px solid #d3adf7;
  font-size: 12px; color: #722ed1;
}
.record-children {
  margin-top: 4px; font-size: 12px; color: #555;
}
.child-tag {
  display: inline-block; padding: 0 6px; border-radius: 3px;
  font-size: 11px; margin: 2px 3px;
}
.child-tag.male { background: #e3f2fd; color: #1565c0; }
.child-tag.female { background: #fce4ec; color: #c62828; }

@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
`;

      const dirLabel = suDirection === 'vertical' ? '（竖排·传统）' : '（横排·现代）';
      const styleName = printStyle === 'su-style' ? `苏式吊线图${dirLabel}` : printStyle === 'tree-style' ? '宝塔树形图' : '欧式世系录';

      // 直系亲属模式的附加信息
      const isLineage = printScope === 'lineage' && targetPersonId;
      const targetPerson = isLineage ? rawData.find((p) => p.id === targetPersonId) : null;
      const lineageLabel = targetPerson ? `${targetPerson.name}（第${targetPerson.generation}世）直系亲属` : '';
      const totalPersons = sortedGens.reduce((sum, g) => sum + (genMap.get(g)?.length || 0), 0);

      // ======= 封面 =======
      html += `<div class="cover">
  <h1>族 谱</h1>
  <div class="subtitle">${isLineage ? lineageLabel : '世代家族传承记录'}</div>
  <div class="gen-range">第 ${genStart} 世 — 第 ${genEnd} 世${isLineage ? ` · 共 ${totalPersons} 人` : ''}</div>
  <div class="style-tag">📜 ${styleName}</div>
  <div class="date">编制日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</div>\n`;

      // ======= 凡例页 =======
      html += `<div class="legend-page">
  <h2>凡 例</h2>
  <div class="legend-item"><strong>一、</strong>${isLineage ? `本谱收录 <strong>${escapeXml(targetPerson!.name)}</strong> 的直系亲属（全部祖先及所有后代），` : '本谱收录'}第 ${genStart} 世至第 ${genEnd} 世族人，共 ${totalPersons} 人。</div>
`;
      if (printStyle === 'su-style') {
        if (suDirection === 'horizontal') {
          html += `  <div class="legend-item"><strong>二、</strong>世系图采用<strong>苏式吊线图·横排</strong>，适合现代阅读习惯。祖先在上，后代在下，自上而下阅读。每五世为一图。</div>
  <div class="legend-item"><strong>三、</strong>图中用<strong>吊线</strong>（竖线 + 横线）连接父子关系：从父节点底部引出竖线向下，至横线处分岔连接各子女。同辈兄弟姐妹由横线串联，按长幼从左到右排列。</div>
  <div class="legend-item"><strong>四、</strong>吊线交接处有<strong>圆点</strong>装饰，模仿传统族谱中的"垂珠"样式。</div>`;
        } else {
          html += `  <div class="legend-item"><strong>二、</strong>世系图采用<strong>苏式吊线图·竖排</strong>，为北宋苏洵所创之传统格式。姓名竖写，世代从右到左排列，最接近古籍中的族谱样式。</div>
  <div class="legend-item"><strong>三、</strong>阅读方式：<strong>从右往左</strong>阅读。右侧为长辈（始祖），左侧为晚辈（后代）。同辈从上到下按长幼排列。</div>
  <div class="legend-item"><strong>四、</strong>图中用<strong>吊线</strong>（横线 + 竖线）连接父子关系：从父节点左侧引出横线，至竖线处分岔连接各子女。吊线交接处有<strong>圆点</strong>装饰。</div>`;
        }
        if (includeSpouse) {
          html += `\n  <div class="legend-item"><strong>五、</strong>姓名旁<strong>紫色小字</strong>标注配偶姓名，以"配"字开头。</div>`;
        }
        if (includeDetail) {
          const n = includeSpouse ? '六' : '五';
          html += `\n  <div class="legend-item"><strong>${n}、</strong>姓名旁<strong>灰色小字</strong>为简要生平信息（生卒、籍贯等）。</div>`;
        }
      } else if (printStyle === 'tree-style') {
        html += `  <div class="legend-item"><strong>二、</strong>世系图采用<strong>宝塔树形图</strong>，祖先在上，后代在下层层展开，如宝塔状排列。每五世为一图。</div>
  <div class="legend-item"><strong>三、</strong>方框内为族人姓名，线条连接父子关系。同辈从左到右按长幼排列。</div>`;
      } else {
        html += `  <div class="legend-item"><strong>二、</strong>世系采用<strong>欧式世系录</strong>（横行体），为北宋欧阳修所创。以表格形式记录，五世一表，每行记载一人。</div>
  <div class="legend-item"><strong>三、</strong>表中"父"列标注父亲姓名，"子女"列标注子女姓名，据此可追溯上下世系。</div>`;
      }
      if (includeDetailPage) {
        html += `\n  <div class="legend-item"><strong>${printStyle === 'table-style' ? '四' : includeDetail && includeSpouse ? '七' : includeDetail || includeSpouse ? '六' : '五'}、</strong>世系图后附有各世<strong>详细世系录</strong>，记载每人的详细生平信息。</div>`;
      }
      html += `\n</div>\n`;

      // ======= 目录 =======
      html += `<div class="toc"><h2>目 录</h2>\n`;
      if (chartSections.length > 0 || printStyle === 'table-style') {
        html += `  <div class="toc-item"><span class="gen-name">📜 世系图</span><span class="person-count">${styleName} · 第 ${genStart} 世 ~ 第 ${genEnd} 世</span></div>\n`;
      }
      if (includeDetailPage) {
        for (const gen of sortedGens) {
          const persons = genMap.get(gen) || [];
          html += `  <div class="toc-item"><span class="gen-name">第 ${gen} 世 世系录</span><span class="person-count">${persons.length} 人</span></div>\n`;
        }
      }
      html += `</div>\n`;

      // ======= 世系图 =======
      if (chartSections.length > 0) {
        for (const section of chartSections) {
          html += `<div class="chart-page">
  <div class="chart-header">世系图 · 第 ${section.sGen} 世 — 第 ${section.eGen} 世</div>
  <div class="chart-container">${section.svg}</div>`;
          if (section.eGen < genEnd) {
            html += `\n  <div class="chart-note">※ 第 ${section.eGen} 世在下一图中重复出现，以便衔接</div>`;
          }
          html += `\n</div>\n`;
        }
      }

      // ======= 欧式表格 =======
      if (printStyle === 'table-style' && tableHTML) {
        html += tableHTML;
      }

      // ======= 详细世系录 =======
      if (includeDetailPage) {
        const childrenMap = new Map<string, TreeNode[]>();
        const walkC = (items: TreeNode[]) => {
          for (const node of items) {
            if (node.children?.length) { childrenMap.set(node.id, node.children); walkC(node.children); }
          }
        };
        walkC(printData);

        const parentMap = buildParentMap(printData);
        const nodeMap = buildNodeMap(printData);

        for (const gen of sortedGens) {
          const persons = genMap.get(gen) || [];
          const c = getColor(gen);
          html += `<div class="gen-page">
  <div class="gen-header">第 ${gen} 世 · 世系录 · 共 ${persons.length} 人</div>\n`;

          for (let pi = 0; pi < persons.length; pi++) {
            const person = persons[pi];
            const detail = detailMap.get(person.id);
            const parentId = parentMap.get(person.id);
            const parentNode = parentId ? nodeMap.get(parentId) : undefined;
            const children = childrenMap.get(person.id);

            html += `  <div class="person-record">
    <div class="record-order" style="background:${c.border}">${pi + 1}</div>
    <div class="record-body">
      <div class="record-name-line">
        <span class="record-name">${escapeXml(person.name)}</span>
        <span class="record-tag ${person.gender}">${person.gender === 'male' ? '男' : '女'}</span>`;
            if (detail?.alias) html += `\n        <span class="record-alias">别名：${escapeXml(detail.alias)}</span>`;
            if (detail?.courtesy) html += `\n        <span class="record-courtesy">字 ${escapeXml(detail.courtesy)}</span>`;
            if (parentNode) html += `\n        <span class="record-parent">父：${escapeXml(parentNode.name)}</span>`;
            html += `\n      </div>`;

            if (includeDetail && detail) {
              html += `\n      <div class="record-detail">`;
              if (detail.alias) html += `<div class="dl"><span class="dl-label">别名：</span>${escapeXml(detail.alias)}</div>`;
              if (detail.courtesy) html += `<div class="dl"><span class="dl-label">字/号：</span>${escapeXml(detail.courtesy)}</div>`;
              if (detail.birthDate) html += `<div class="dl"><span class="dl-label">生：</span>${formatDate(detail.birthDate)}</div>`;
              if (detail.deathDate) html += `<div class="dl"><span class="dl-label">殁：</span>${formatDate(detail.deathDate)}</div>`;
              if (detail.birthPlace) html += `<div class="dl"><span class="dl-label">籍：</span>${escapeXml(detail.birthPlace)}</div>`;
              if (detail.address) html += `<div class="dl"><span class="dl-label">住：</span>${escapeXml(detail.address)}</div>`;
              if (detail.occupation) html += `<div class="dl"><span class="dl-label">业：</span>${escapeXml(detail.occupation)}</div>`;
              if (detail.phone) html += `<div class="dl"><span class="dl-label">电话：</span>${escapeXml(detail.phone)}</div>`;
              html += `\n      </div>`;
            }

            if (includeBio && detail?.bio) {
              html += `\n      <div class="record-bio">${escapeXml(detail.bio)}</div>`;
            }

            if (includeSpouse && person.spouseName) {
              html += `\n      <div class="record-spouse">配偶：${escapeXml(person.spouseName)}`;
              if (detail?.spouseBirthDate) html += ` · 生${escapeXml(detail.spouseBirthDate)}`;
              if (detail?.spouseDeathDate) html += ` · 殁${escapeXml(detail.spouseDeathDate)}`;
              if (detail?.spouseBirthPlace) html += ` · 籍${escapeXml(detail.spouseBirthPlace)}`;
              if (detail?.spouseOccupation) html += ` · ${escapeXml(detail.spouseOccupation)}`;
              html += `</div>`;
            }

            if (children && children.length > 0) {
              html += `\n      <div class="record-children">子女（${children.length}人）：`;
              for (const child of children) {
                html += `<span class="child-tag ${child.gender}">${escapeXml(child.name)}</span>`;
              }
              html += `</div>`;
            }

            html += `\n    </div>\n  </div>\n`;
          }
          html += `</div>\n`;
        }
      }

      html += `</body></html>`;
      return html;
    },
    [effectiveTreeData, genStart, genEnd, includeDetail, includeSpouse, includeBio, includeDetailPage, printStyle, suDirection, printScope, targetPersonId, rawData],
  );

  // ============= 打印/预览 =============
  const handlePrint = useCallback(async () => {
    if (printScope === 'lineage' && !targetPersonId) {
      message.warning('请先选择要打印直系亲属的目标人物');
      return;
    }
    setPrinting(true);
    try {
      const detailMap = await loadDetailMap();
      const html = generatePrintHTML(detailMap);
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) { doc.open(); doc.write(html); doc.close(); await new Promise((r) => setTimeout(r, 800)); iframe.contentWindow?.print(); }
      setTimeout(() => document.body.removeChild(iframe), 3000);
      message.success('打印预览已打开');
    } catch (err) { console.error('打印失败:', err); message.error('打印失败，请重试'); }
    finally { setPrinting(false); }
  }, [loadDetailMap, generatePrintHTML, printScope, targetPersonId]);

  const handlePreview = useCallback(async () => {
    if (printScope === 'lineage' && !targetPersonId) {
      message.warning('请先选择要打印直系亲属的目标人物');
      return;
    }
    setPrinting(true);
    try {
      const detailMap = await loadDetailMap();
      const html = generatePrintHTML(detailMap);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) { console.error('预览失败:', err); message.error('预览失败，请重试'); }
    finally { setPrinting(false); }
  }, [loadDetailMap, generatePrintHTML, printScope, targetPersonId]);

  const genOptions = generationRange.list.map((g) => ({ label: `第 ${g} 世`, value: g }));

  return (
    <Modal
      title={<span><PrinterOutlined style={{ marginRight: 8 }} />世代分页打印装订</span>}
      open={visible}
      onCancel={onClose}
      width={620}
      footer={null}
      destroyOnClose
    >
      <Spin spinning={printing} tip="正在生成打印内容...">
        <div style={{ padding: '12px 0' }}>
          {/* 图谱样式 */}
          <Divider orientation="left" style={{ fontSize: 14 }}>
            图谱样式
            <Tooltip title="参照中国传统族谱格式：苏式（吊线图）、宝塔式（横排树形图）、欧式（表格世系录）">
              <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999' }} />
            </Tooltip>
          </Divider>

          <Radio.Group
            value={printStyle}
            onChange={(e) => setPrintStyle(e.target.value)}
            style={{ marginBottom: 12 }}
          >
            <Radio.Button value="su-style">
              📜 苏式吊线图
            </Radio.Button>
            <Radio.Button value="tree-style">
              🏯 宝塔树形图
            </Radio.Button>
            <Radio.Button value="table-style">
              📋 欧式世系录
            </Radio.Button>
          </Radio.Group>

          {/* 苏式吊线图的方向选择 */}
          {printStyle === 'su-style' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>排列方向：</div>
              <Radio.Group
                value={suDirection}
                onChange={(e) => setSuDirection(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="horizontal">
                  ↕ 横排（现代）
                </Radio.Button>
                <Radio.Button value="vertical">
                  ↔ 竖排（传统）
                </Radio.Button>
              </Radio.Group>
            </div>
          )}

          <div style={{
            padding: '8px 12px', background: '#fdf6ec', border: '1px solid #f0dfc0',
            borderRadius: 6, fontSize: 12, color: '#8b6914', marginBottom: 12,
          }}>
            {printStyle === 'su-style' && suDirection === 'horizontal' && '横排苏式吊线图。祖先在上、后代在下，姓名横排，吊线（竖线+横线+圆点）连接父子关系。符合现代从上到下、从左到右的阅读习惯。'}
            {printStyle === 'su-style' && suDirection === 'vertical' && '竖排苏式吊线图（垂珠体）。北宋苏洵所创传统格式。姓名竖写，世代从右到左排列，吊线（横线+竖线+圆点）连接父子关系。最接近古籍中的族谱绘制方式，横向打印。'}
            {printStyle === 'tree-style' && '宝塔树形图。祖先在上，后代在下层层展开，如宝塔状排列。直观易读，适合支系较少的家族。'}
            {printStyle === 'table-style' && '欧阳修所创。以表格形式记录世系，每行一人附注生平，查阅方便。适合需要详细资料的场景。'}
          </div>

          {/* 打印范围 */}
          <Divider orientation="left" style={{ fontSize: 14 }}>
            打印范围
            <Tooltip title="选择打印全族或仅打印某个人的直系亲属（所有祖先+自身+所有后代）">
              <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999' }} />
            </Tooltip>
          </Divider>

          <Radio.Group
            value={printScope}
            onChange={(e) => setPrintScope(e.target.value)}
            style={{ marginBottom: 12 }}
          >
            <Radio.Button value="all">👥 全族</Radio.Button>
            <Radio.Button value="lineage">🧬 指定人物直系亲属</Radio.Button>
          </Radio.Group>

          {printScope === 'lineage' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>选择目标人物：</div>
              <Select
                showSearch
                value={targetPersonId}
                onChange={setTargetPersonId}
                placeholder="搜索并选择人物"
                style={{ width: '100%' }}
                options={personOptions}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
              <div style={{ marginTop: 6, fontSize: 12, color: '#999', lineHeight: 1.5 }}>
                将自动包含该人物的所有直系祖先和所有后代，从数据库完整数据中提取，不受画布展开状态影响。
              </div>
            </div>
          )}

          {/* 世代范围 */}
          <Divider orientation="left" style={{ fontSize: 14 }}>世代范围（五世一图）</Divider>

          <Space size="middle" style={{ marginBottom: 12 }}>
            <span>从</span>
            <Select value={genStart} onChange={(v) => setGenStart(v)} options={genOptions} style={{ width: 120 }} />
            <span>到</span>
            <Select value={genEnd} onChange={(v) => setGenEnd(v)} options={genOptions} style={{ width: 120 }} />
          </Space>

          {/* 打印内容 */}
          <Divider orientation="left" style={{ fontSize: 14 }}>打印内容</Divider>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <Checkbox checked={includeDetail} onChange={(e) => setIncludeDetail(e.target.checked)}>
              图中标注简要信息（生卒、籍贯）
            </Checkbox>
            <Checkbox checked={includeSpouse} onChange={(e) => setIncludeSpouse(e.target.checked)}>
              图中标注配偶
            </Checkbox>
            <Checkbox checked={includeDetailPage} onChange={(e) => setIncludeDetailPage(e.target.checked)}>
              附录：详细世系录（每人的完整信息、子女列表）
            </Checkbox>
            <Checkbox
              checked={includeBio}
              onChange={(e) => setIncludeBio(e.target.checked)}
              disabled={!includeDetailPage}
              style={{ marginLeft: 24 }}
            >
              包含个人生平简介
            </Checkbox>
          </div>

          <Divider />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button icon={<FilePdfOutlined />} onClick={handlePreview}>预览</Button>
            <Button type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>打印</Button>
          </div>
        </div>
      </Spin>
    </Modal>
  );
};

export default PrintDialog;

// ============= 宝塔树形图布局和渲染 =============

interface TreeLayoutNode {
  id: string; name: string; gender: 'male' | 'female'; generation: number;
  spouseName?: string; x: number; y: number; children: TreeLayoutNode[];
}

const TL_NODE_W = 80;
const TL_NODE_H = 32;
const TL_H_GAP = 16;
const TL_V_GAP = 50;

function treeStyleLayout(nodes: TreeNode[], startGen: number, endGen: number): TreeLayoutNode[] {
  let nextX = 0;
  function layout(node: TreeNode): TreeLayoutNode | null {
    if (node.generation > endGen) return null;
    const children: TreeLayoutNode[] = [];
    if (node.children?.length && node.generation < endGen) {
      for (const child of node.children) { const lc = layout(child); if (lc) children.push(lc); }
    }
    const y = (node.generation - startGen) * (TL_NODE_H + TL_V_GAP);
    if (children.length === 0) {
      const x = nextX; nextX += TL_NODE_W + TL_H_GAP;
      return { id: node.id, name: node.name, gender: node.gender, generation: node.generation, spouseName: node.spouseName, x, y, children };
    }
    const x = (children[0].x + children[children.length - 1].x + TL_NODE_W) / 2 - TL_NODE_W / 2;
    return { id: node.id, name: node.name, gender: node.gender, generation: node.generation, spouseName: node.spouseName, x, y, children };
  }
  const roots: TreeLayoutNode[] = [];
  for (const node of nodes) { if (node.generation >= startGen && node.generation <= endGen) { const ln = layout(node); if (ln) roots.push(ln); } }
  return roots;
}

function generateTreeStyleSVG(
  roots: TreeLayoutNode[], detailMap: Map<string, Person>, genColors: GenerationColorItem[],
  startGen: number, endGen: number, includeSpouse: boolean,
): string {
  if (roots.length === 0) return '';
  const getColor = (gen: number) => { const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length; return genColors[idx]; };
  const allNodes: TreeLayoutNode[] = [];
  const links: { sx: number; sy: number; tx: number; ty: number; gen: number }[] = [];
  function collect(n: TreeLayoutNode) {
    allNodes.push(n);
    for (const c of n.children) { links.push({ sx: n.x + TL_NODE_W / 2, sy: n.y + TL_NODE_H, tx: c.x + TL_NODE_W / 2, ty: c.y, gen: n.generation }); collect(c); }
  }
  for (const r of roots) collect(r);
  if (allNodes.length === 0) return '';

  const spExtra = includeSpouse ? 50 : 0;
  const maxX = Math.max(...allNodes.map((n) => n.x + TL_NODE_W + spExtra)) + 20;
  const maxY = Math.max(...allNodes.map((n) => n.y + TL_NODE_H)) + 20;
  const pad = 40; const leftM = 40;
  const svgW = maxX + pad * 2 + leftM;
  const svgH = maxY + pad + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:'SimSun','宋体',serif;">\n`;
  svg += `<rect width="100%" height="100%" fill="#fffef8"/>\n`;

  for (let g = startGen; g <= endGen; g++) {
    const ry = (g - startGen) * (TL_NODE_H + TL_V_GAP) + pad;
    const c = getColor(g);
    if ((g - startGen) % 2 === 0) svg += `<rect x="0" y="${ry - 4}" width="${svgW}" height="${TL_NODE_H + 8}" fill="${c.bg}" opacity="0.25"/>\n`;
    svg += `<text x="12" y="${ry + TL_NODE_H / 2}" font-size="11" font-weight="bold" fill="${c.text}" dominant-baseline="central">${g}世</text>\n`;
  }

  svg += `<g transform="translate(${pad + leftM},${pad})">\n`;

  for (const lk of links) {
    const c = getColor(lk.gen);
    const midY = (lk.sy + lk.ty) / 2;
    svg += `<path d="M${lk.sx},${lk.sy} L${lk.sx},${midY} L${lk.tx},${midY} L${lk.tx},${lk.ty}" fill="none" stroke="${c.border}" stroke-width="1.2" opacity="0.7"/>\n`;
  }

  for (const n of allNodes) {
    const c = getColor(n.generation);
    const gc = n.gender === 'male' ? '#1677ff' : '#eb2f96';
    svg += `<rect x="${n.x}" y="${n.y}" width="${TL_NODE_W}" height="${TL_NODE_H}" rx="4" fill="${c.bg}" stroke="${c.border}" stroke-width="1.2"/>\n`;
    const dn = n.name.length > 4 ? n.name.slice(0, 4) + '…' : n.name;
    svg += `<text x="${n.x + TL_NODE_W / 2}" y="${n.y + TL_NODE_H / 2 + 1}" font-size="12" font-weight="bold" fill="${c.text}" text-anchor="middle" dominant-baseline="central">${escapeXml(dn)}</text>\n`;
    svg += `<text x="${n.x + TL_NODE_W - 8}" y="${n.y + 10}" font-size="8" fill="${gc}">${n.gender === 'male' ? '♂' : '♀'}</text>\n`;

    if (includeSpouse && n.spouseName) {
      const spX = n.x + TL_NODE_W + 3;
      const spW = 44; const spH = TL_NODE_H - 6;
      const spY = n.y + 3;
      svg += `<line x1="${n.x + TL_NODE_W}" y1="${n.y + TL_NODE_H / 2}" x2="${spX}" y2="${spY + spH / 2}" stroke="#d3adf7" stroke-width="1" stroke-dasharray="3,2"/>\n`;
      svg += `<rect x="${spX}" y="${spY}" width="${spW}" height="${spH}" rx="3" fill="#f8f4ff" stroke="#d3adf7" stroke-width="1" stroke-dasharray="3,2"/>\n`;
      const sn = n.spouseName.length > 3 ? n.spouseName.slice(0, 3) + '…' : n.spouseName;
      svg += `<text x="${spX + spW / 2}" y="${spY + spH / 2 + 1}" font-size="10" fill="#722ed1" text-anchor="middle" dominant-baseline="central">${escapeXml(sn)}</text>\n`;
    }
  }

  svg += `</g>\n</svg>\n`;
  return svg;
}

// ============= 欧式世系录表格 =============

function generateEuStyleTable(
  treeData: TreeNode[], detailMap: Map<string, Person>, genColors: GenerationColorItem[],
  genStart: number, genEnd: number, includeSpouse: boolean, includeDetail: boolean,
): string {
  const genMap = flattenByGeneration(treeData);
  const parentMap = buildParentMap(treeData);
  const nodeMap = buildNodeMap(treeData);
  const childrenMap = new Map<string, TreeNode[]>();
  const walk = (items: TreeNode[]) => { for (const n of items) { if (n.children?.length) { childrenMap.set(n.id, n.children); walk(n.children); } } };
  walk(treeData);

  const getColor = (gen: number) => { const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length; return genColors[idx]; };
  const sortedGens = Array.from(genMap.keys()).sort((a, b) => a - b).filter((g) => g >= genStart && g <= genEnd);

  const GENS_PER_TABLE = 5;
  let html = '';

  for (let tStart = genStart; tStart <= genEnd; tStart += GENS_PER_TABLE - 1) {
    const tEnd = Math.min(tStart + GENS_PER_TABLE - 1, genEnd);
    const tableGens = sortedGens.filter((g) => g >= tStart && g <= tEnd);

    html += `<div class="eu-table-page">
  <div class="chart-header">欧式世系录 · 第 ${tStart} 世 — 第 ${tEnd} 世</div>
  <table class="eu-table">
    <thead><tr>
      <th>世</th><th>姓名</th><th>性别</th><th>父</th>`;
    if (includeDetail) html += `<th>生卒籍贯</th>`;
    if (includeSpouse) html += `<th>配偶</th>`;
    html += `<th>子女</th>
    </tr></thead>
    <tbody>\n`;

    for (const gen of tableGens) {
      const persons = genMap.get(gen) || [];
      const c = getColor(gen);
      for (const p of persons) {
        const detail = detailMap.get(p.id);
        const pId = parentMap.get(p.id);
        const pNode = pId ? nodeMap.get(pId) : undefined;
        const children = childrenMap.get(p.id);
        const gc = p.gender === 'male' ? 'eu-gender-m' : 'eu-gender-f';

        html += `    <tr>
      <td style="text-align:center;background:${c.bg};color:${c.text};font-weight:bold">${gen}</td>
      <td class="eu-name-cell">${escapeXml(p.name)}${detail?.courtesy ? ` <small style="color:#8b4513">字${escapeXml(detail.courtesy)}</small>` : ''}</td>
      <td class="${gc}" style="text-align:center">${p.gender === 'male' ? '男' : '女'}</td>
      <td>${pNode ? escapeXml(pNode.name) : '—'}</td>`;

        if (includeDetail) {
          const parts: string[] = [];
          if (detail?.birthDate) parts.push(`生${detail.birthDate}`);
          if (detail?.deathDate) parts.push(`殁${detail.deathDate}`);
          if (detail?.birthPlace) parts.push(`籍${escapeXml(detail.birthPlace)}`);
          if (detail?.occupation) parts.push(escapeXml(detail.occupation));
          html += `\n      <td class="eu-detail">${parts.join('　') || '—'}</td>`;
        }
        if (includeSpouse) {
          const spParts: string[] = [];
          if (p.spouseName) spParts.push(escapeXml(p.spouseName));
          if (detail?.spouseBirthPlace) spParts.push(`籍${escapeXml(detail.spouseBirthPlace)}`);
          if (detail?.spouseOccupation) spParts.push(escapeXml(detail.spouseOccupation));
          html += `\n      <td class="eu-spouse">${spParts.length > 0 ? spParts.join('　') : '—'}</td>`;
        }
        html += `\n      <td class="eu-children">${children ? children.map((ch) => `<span class="child-tag ${ch.gender}">${escapeXml(ch.name)}</span>`).join(' ') : '—'}</td>`;
        html += `\n    </tr>\n`;
      }
    }

    html += `    </tbody></table>\n</div>\n`;
    if (tEnd >= genEnd) break;
  }

  return html;
}
