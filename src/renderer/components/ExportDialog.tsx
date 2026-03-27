import React, { useState, useMemo } from 'react';
import { Modal, Radio, Select, Button, Progress, Checkbox, message } from 'antd';
import * as d3 from 'd3';
import { api } from '../api/bridge';
import type { PersonIndex, TreeNode, Person } from '../types/person';
import {
  getGenerationColors,
  getGenderedColor,
  type GenerationColorItem,
} from '../utils/generationColors';

type ExportScope = 'all' | 'lineage';

interface ExportDialogProps {
  visible: boolean;
  onClose: () => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** 扁平人员索引数据（用于查找祖先链） */
  rawData?: PersonIndex[];
  /** 当前树形数据（用于查找后代） */
  treeData?: TreeNode[];
  /** 当前选中的节点 ID（用于默认选择导出目标） */
  selectedId?: string | null;
  /** 所有人员详细数据的映射（用于获取字/号等完整信息） */
  personDetailMap?: Map<string, Person>;
  /** 辈分字映射：世数 → 辈分字 */
  generationChars?: Record<number, string>;
}

// ======== 节点尺寸常量（与 FamilyTree.tsx 保持一致） ========
const NODE_WIDTH = 120;
const NODE_HEIGHT = 76;
const H_SPACING = 40;
const V_SPACING = 100;

/** 获取指定人物的所有直系祖先 ID（从 rawData 中向上追溯 parentId） */
function getAncestorIds(id: string, rawData: PersonIndex[]): Set<string> {
  const ancestors = new Set<string>();
  const personMap = new Map<string, PersonIndex>();
  for (const p of rawData) {
    personMap.set(p.id, p);
  }
  let currentId: string | null = id;
  while (currentId) {
    const person = personMap.get(currentId);
    if (!person || !person.parentId) break;
    ancestors.add(person.parentId);
    currentId = person.parentId;
  }
  return ancestors;
}

/** 从 rawData 中获取指定人物的所有后代 ID（纯粹基于 parentId 关系，不受展开状态影响） */
function getAllDescendantIdsFromRawData(
  personId: string,
  rawData: PersonIndex[],
): Set<string> {
  // 先建立 parentId → children 的映射
  const childrenMap = new Map<string, string[]>();
  for (const p of rawData) {
    if (p.parentId) {
      if (!childrenMap.has(p.parentId)) {
        childrenMap.set(p.parentId, []);
      }
      childrenMap.get(p.parentId)!.push(p.id);
    }
  }

  // BFS 收集所有后代
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

/** 用于 D3 hierarchy 的节点结构 */
interface LineageNode {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  spouseName?: string;
  courtesy?: string;
  children?: LineageNode[];
}

/**
 * 从 rawData 中构建仅包含直系血脉的树（祖先链 + 目标人物 + 所有后代）
 * 返回根节点（最远的祖先）
 */
function buildLineageTree(
  targetId: string,
  rawData: PersonIndex[],
  personDetailMap?: Map<string, Person>,
): LineageNode | null {
  const personMap = new Map<string, PersonIndex>();
  for (const p of rawData) {
    personMap.set(p.id, p);
  }

  const target = personMap.get(targetId);
  if (!target) return null;

  const ancestorIds = getAncestorIds(targetId, rawData);
  const descendantIds = getAllDescendantIdsFromRawData(targetId, rawData);
  const keepIds = new Set<string>([targetId, ...ancestorIds, ...descendantIds]);

  // 建立 parentId → children 映射（只保留需要的人）
  const childrenMap = new Map<string, PersonIndex[]>();
  for (const p of rawData) {
    if (!keepIds.has(p.id)) continue;
    if (p.parentId && keepIds.has(p.parentId)) {
      if (!childrenMap.has(p.parentId)) {
        childrenMap.set(p.parentId, []);
      }
      childrenMap.get(p.parentId)!.push(p);
    }
  }

  // 对每组子节点按 sortOrder 排序
  for (const [, children] of childrenMap) {
    children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // 递归构建树节点
  function buildNode(p: PersonIndex): LineageNode {
    const children = childrenMap.get(p.id) || [];
    const detail = personDetailMap?.get(p.id);
    return {
      id: p.id,
      name: p.name,
      gender: p.gender,
      generation: p.generation,
      spouseName: p.spouseName,
      courtesy: detail?.courtesy,
      children: children.length > 0 ? children.map(buildNode) : undefined,
    };
  }

  // 找到根节点：祖先链中最远的那个（没有 parentId 在 keepIds 中的）
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
  if (!rootPerson) return null;

  return buildNode(rootPerson);
}

/**
 * 独立渲染直系血脉子树为 SVG 元素
 * 不依赖画布上的 SVG，完全独立生成
 */
function renderLineageSvg(
  lineageRoot: LineageNode,
  targetId: string,
  showSpouse = false,
  generationChars: Record<number, string> = {},
): SVGSVGElement {
  const PADDING = 40;

  // 配偶框常量
  const SPOUSE_BOX_W = 80;
  const SPOUSE_BOX_H = 52;
  const SPOUSE_GAP = 6;

  // 获取世代颜色配置
  const genColors = getGenerationColors();
  const getColor = (gen: number): GenerationColorItem => {
    const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length;
    return genColors[idx];
  };
  const getNodeColor = (gen: number, gender: 'male' | 'female'): GenerationColorItem => {
    return getGenderedColor(getColor(gen), gender);
  };

  // 创建临时 SVG 和 g
  const svgNs = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(svgNs, 'svg');
  svgEl.setAttribute('xmlns', svgNs);

  // 临时挂载到文档以便 D3 操作和 getBBox
  svgEl.style.position = 'absolute';
  svgEl.style.left = '-99999px';
  svgEl.style.top = '-99999px';
  svgEl.style.visibility = 'hidden';
  // 给一个大的初始尺寸以确保布局正确
  svgEl.setAttribute('width', '10000');
  svgEl.setAttribute('height', '10000');
  document.body.appendChild(svgEl);

  try {
    const svg = d3.select(svgEl);
    const g = svg.append('g').attr('class', 'tree-root');

    // 构建 D3 hierarchy
    const root = d3.hierarchy(lineageRoot);
    const spouseExtra = showSpouse ? (SPOUSE_GAP + SPOUSE_BOX_W) : 0;
    const treeLayout = d3
      .tree<LineageNode>()
      .nodeSize([NODE_WIDTH + spouseExtra + H_SPACING, NODE_HEIGHT + V_SPACING]);
    treeLayout(root);

    // 按 generation 对齐 Y 坐标（与 FamilyTree.tsx 一致的逻辑）
    {
      const allNodes = root.descendants();
      const genMaxY = new Map<number, number>();
      for (const n of allNodes) {
        const gen = n.data.generation;
        const curMax = genMaxY.get(gen);
        if (curMax === undefined || n.y! > curMax) {
          genMaxY.set(gen, n.y!);
        }
      }
      const sortedGens = Array.from(genMaxY.keys()).sort((a, b) => a - b);
      const genY = new Map<number, number>();
      const rowHeight = NODE_HEIGHT + V_SPACING;
      for (let i = 0; i < sortedGens.length; i++) {
        const gen = sortedGens[i];
        if (i === 0) {
          genY.set(gen, genMaxY.get(gen)!);
        } else {
          const prevGen = sortedGens[i - 1];
          const prevY = genY.get(prevGen)!;
          const candidateY = Math.max(genMaxY.get(gen)!, prevY + rowHeight);
          genY.set(gen, candidateY);
        }
      }
      for (const n of allNodes) {
        const targetY = genY.get(n.data.generation);
        if (targetY !== undefined) {
          n.y = targetY;
        }
      }
    }

    // 绘制连线
    const nodes = root.descendants();
    const linksData = root.links();
    g.selectAll('.tree-link')
      .data(linksData)
      .enter()
      .append('path')
      .attr('class', 'tree-link')
      .attr('d', (d) => {
        const sx = d.source.x!;
        const sy = d.source.y! + NODE_HEIGHT / 2;
        const tx = d.target.x!;
        const ty = d.target.y! - NODE_HEIGHT / 2;
        const my = (sy + ty) / 2;
        return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
      })
      .style('fill', 'none')
      .style('stroke', '#b0b0b0')
      .style('stroke-width', '1.5px');

    // 祖先链上的连线高亮
    const ancestorIds = getAncestorIds(targetId, []);
    // 重新用完整节点列表计算祖先
    const ancestorIdsSet = new Set<string>();
    let curId: string | null = targetId;
    const nodeMap = new Map<string, LineageNode>();
    function collectToMap(n: LineageNode) {
      nodeMap.set(n.id, n);
      n.children?.forEach(collectToMap);
    }
    collectToMap(lineageRoot);

    // 向上追溯祖先
    while (curId) {
      const found = root.descendants().find((d) => d.data.id === curId);
      if (found?.parent) {
        ancestorIdsSet.add(found.parent.data.id);
        curId = found.parent.data.id;
      } else {
        break;
      }
    }
    ancestorIdsSet.add(targetId); // 加入自身

    // 高亮祖先链连线
    g.selectAll('.tree-link')
      .each(function (this: SVGPathElement, d: any) {
        const sourceId = d.source.data.id;
        const tId = d.target.data.id;
        if (ancestorIdsSet.has(tId) && ancestorIdsSet.has(sourceId)) {
          d3.select(this)
            .style('stroke', '#1677ff')
            .style('stroke-width', '2.5px');
        }
      });

    // 绘制节点
    const nodeGroup = g
      .selectAll('.tree-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'tree-node')
      .attr('transform', (d) =>
        `translate(${d.x! - NODE_WIDTH / 2}, ${d.y! - NODE_HEIGHT / 2})`,
      );

    // 节点矩形
    nodeGroup
      .append('rect')
      .attr('width', NODE_WIDTH)
      .attr('height', NODE_HEIGHT)
      .attr('rx', 8)
      .attr('ry', 8)
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        const sel = d3.select(this);
        sel
          .style('fill', c.bg)
          .style('stroke', c.border)
          .style('stroke-width', '2px');
        // 目标人物：加粗边框
        if (d.data.id === targetId) {
          sel
            .style('stroke', '#1677ff')
            .style('stroke-width', '3px');
        }
      });

    // 性别图标
    nodeGroup
      .append('text')
      .attr('x', NODE_WIDTH - 16)
      .attr('y', 14)
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', '0.7')
      .text((d) => d.data.gender === 'male' ? '♂' : '♀')
      .each(function (d) {
        const color = d.data.gender === 'male' ? '#1677ff' : '#eb2f96';
        d3.select(this).style('fill', color);
      });

    // 姓名
    nodeGroup
      .append('text')
      .attr('class', 'node-name')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', NODE_HEIGHT / 2 - 6)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'central')
      .style('font-size', '13px')
      .style('font-weight', '600')
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        const name = d.data.name;
        const displayName = name.length > 6 ? name.slice(0, 6) + '…' : name;
        d3.select(this)
          .style('fill', c.text)
          .text(displayName);
      });

    // 字/号（姓名下方，有 courtesy 时显示）
    nodeGroup
      .filter((d) => !!d.data.courtesy)
      .append('text')
      .attr('class', 'node-courtesy')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', NODE_HEIGHT / 2 + 6)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'central')
      .style('font-size', '10px')
      .style('pointer-events', 'none')
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        d3.select(this)
          .style('fill', c.text)
          .style('opacity', '0.55')
          .text(`字 ${d.data.courtesy}`);
      });

    // 世数小字
    nodeGroup
      .append('text')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', NODE_HEIGHT / 2 + 14)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'central')
      .style('font-size', '10px')
      .style('opacity', '0.55')
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        // 有字号时世数往下移
        const hasCourtesy = !!d.data.courtesy;
        if (hasCourtesy) {
          d3.select(this).attr('y', NODE_HEIGHT / 2 + 20);
        }
        d3.select(this)
          .style('fill', c.text)
          .text(`第${d.data.generation}世`);
      });

    // 世代行首标签
    const generationYMap = new Map<number, number>();
    for (const n of nodes) {
      const gen = n.data.generation;
      if (!generationYMap.has(gen)) {
        generationYMap.set(gen, n.y!);
      }
    }

    const minNodeX = d3.min(nodes, (d) => d.x!) || 0;
    const labelX = minNodeX - NODE_WIDTH / 2 - 60;

    for (const [gen, yPos] of generationYMap.entries()) {
      const c = getColor(gen);
      const genChar = generationChars[gen];
      const labelText = genChar ? `${gen}世·${genChar}` : `${gen}世`;
      const labelWidth = genChar ? 64 : 48;

      g.append('rect')
        .attr('class', 'gen-label-bg')
        .attr('x', labelX - labelWidth / 2)
        .attr('y', yPos - 12)
        .attr('width', labelWidth)
        .attr('height', 24)
        .attr('rx', 12)
        .attr('ry', 12)
        .style('fill', c.bg)
        .style('stroke', c.border)
        .style('stroke-width', '1.5px');

      g.append('text')
        .attr('class', 'gen-label-text')
        .attr('x', labelX)
        .attr('y', yPos)
        .style('fill', c.text)
        .style('font-size', '11px')
        .style('font-weight', '600')
        .style('text-anchor', 'middle')
        .style('dominant-baseline', 'central')
        .style('pointer-events', 'none')
        .text(labelText);
    }

    // 配偶小框（仅在 showSpouse 模式下渲染）
    if (showSpouse) {
      const spouseNodes = nodeGroup.filter((d) => !!d.data.spouseName);

      // 连接短线
      spouseNodes
        .append('line')
        .attr('class', 'spouse-link')
        .attr('x1', NODE_WIDTH)
        .attr('y1', NODE_HEIGHT / 2)
        .attr('x2', NODE_WIDTH + SPOUSE_GAP)
        .attr('y2', NODE_HEIGHT / 2)
        .style('stroke', '#d9d9d9')
        .style('stroke-width', '1.5px')
        .style('stroke-dasharray', '3,2');

      // 配偶框背景
      spouseNodes
        .append('rect')
        .attr('class', 'spouse-box')
        .attr('x', NODE_WIDTH + SPOUSE_GAP)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2)
        .attr('width', SPOUSE_BOX_W)
        .attr('height', SPOUSE_BOX_H)
        .attr('rx', 6)
        .attr('ry', 6)
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          d3.select(this)
            .style('fill', c.bg)
            .style('stroke', c.border)
            .style('stroke-width', '1.5px')
            .style('stroke-dasharray', '4,2')
            .style('opacity', '0.85');
        });

      // 配偶"配偶"小标签
      spouseNodes
        .append('text')
        .attr('class', 'spouse-label')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 14)
        .style('font-size', '9px')
        .style('text-anchor', 'middle')
        .style('dominant-baseline', 'central')
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.55')
            .text('配偶');
        });

      // 配偶框中的姓名
      spouseNodes
        .append('text')
        .attr('class', 'spouse-name')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 30)
        .style('font-size', '11px')
        .style('text-anchor', 'middle')
        .style('dominant-baseline', 'central')
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          const spouseName = d.data.spouseName!;
          const displayName = spouseName.length > 4 ? spouseName.slice(0, 4) + '…' : spouseName;
          d3.select(this)
            .style('fill', c.text)
            .style('font-weight', '600')
            .text(displayName);
        });
    }

    // 计算 BBox
    const gNode = g.node() as SVGGElement;
    const bbox = gNode.getBBox();

    const exportWidth = bbox.width + PADDING * 2;
    const exportHeight = bbox.height + PADDING * 2;

    // 重置 g 的 transform 为 0（BBox 已经基于无 transform 的坐标）
    g.attr('transform', '');

    svgEl.setAttribute('width', String(exportWidth));
    svgEl.setAttribute('height', String(exportHeight));
    svgEl.setAttribute(
      'viewBox',
      `${bbox.x - PADDING} ${bbox.y - PADDING} ${exportWidth} ${exportHeight}`,
    );

    // 添加白色背景
    const bgRect = document.createElementNS(svgNs, 'rect');
    bgRect.setAttribute('x', String(bbox.x - PADDING));
    bgRect.setAttribute('y', String(bbox.y - PADDING));
    bgRect.setAttribute('width', String(exportWidth));
    bgRect.setAttribute('height', String(exportHeight));
    bgRect.setAttribute('fill', '#ffffff');
    svgEl.insertBefore(bgRect, svgEl.firstChild);

    // 内联 CSS 样式
    const styleSheets = document.styleSheets;
    let cssText = '';
    try {
      for (const sheet of styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            cssText += rule.cssText + '\n';
          }
        } catch {
          // 跨域样式表跳过
        }
      }
    } catch {
      // ignore
    }
    if (cssText) {
      const styleEl = document.createElementNS(svgNs, 'style');
      styleEl.textContent = cssText;
      svgEl.insertBefore(styleEl, svgEl.firstChild);
    }
  } finally {
    // 从文档中移除
    document.body.removeChild(svgEl);
  }

  // 清除临时 style
  svgEl.style.removeProperty('position');
  svgEl.style.removeProperty('left');
  svgEl.style.removeProperty('top');
  svgEl.style.removeProperty('visibility');
  if (!svgEl.getAttribute('style')?.trim()) {
    svgEl.removeAttribute('style');
  }

  return svgEl;
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  visible,
  onClose,
  svgRef,
  rawData = [],
  treeData = [],
  selectedId,
  personDetailMap,
  generationChars = {},
}) => {
  const [format, setFormat] = useState<'svg' | 'png'>('png');
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [targetPersonId, setTargetPersonId] = useState<string | null>(selectedId ?? null);
  const [exportSpouse, setExportSpouse] = useState(true);

  // 当 selectedId 变化时同步更新 targetPersonId
  React.useEffect(() => {
    if (visible && selectedId) {
      setTargetPersonId(selectedId);
    }
  }, [visible, selectedId]);

  // 人员选项列表（用于搜索选择）
  const personOptions = useMemo(() => {
    return rawData
      .filter((p) => !p.id.startsWith('__placeholder__'))
      .map((p) => ({
        label: `${p.name}（第${p.generation}世）`,
        value: p.id,
      }));
  }, [rawData]);

  const handleExport = async () => {
    // 如果是直系血脉导出，需要确认已选择目标人物
    if (exportScope === 'lineage' && !targetPersonId) {
      message.warning('请先选择要导出直系血脉的人物');
      return;
    }

    setExporting(true);
    setProgress(10);

    try {
      const PADDING = 40;
      let clonedSvg: SVGSVGElement;
      let exportBBox: { x: number; y: number; width: number; height: number };

      if (exportScope === 'lineage' && targetPersonId) {
        // ====== 直系血脉模式：从 rawData 独立构建子树并渲染 ======
        setProgress(15);

        const lineageRoot = buildLineageTree(targetPersonId, rawData, personDetailMap);
        if (!lineageRoot) {
          message.error('未找到目标人物数据');
          setExporting(false);
          setProgress(0);
          return;
        }

        setProgress(25);

        // 独立渲染 SVG（已包含背景、样式、正确的 viewBox）
        clonedSvg = renderLineageSvg(lineageRoot, targetPersonId, exportSpouse, generationChars);

        // 从 viewBox 解析 BBox
        const vb = clonedSvg.getAttribute('viewBox')?.split(/\s+/).map(Number) || [0, 0, 800, 600];
        exportBBox = { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
      } else {
        // ====== 全图模式：克隆当前画布 SVG ======
        const svgEl =
          svgRef.current ??
          (document.querySelector('.tree-container svg') as SVGSVGElement | null);
        if (!svgEl) {
          message.error('未找到树形图');
          setExporting(false);
          setProgress(0);
          return;
        }

        const treeRoot = svgEl.querySelector('g.tree-root') as SVGGElement | null;
        if (!treeRoot) {
          message.error('未找到树形图内容');
          setExporting(false);
          setProgress(0);
          return;
        }

        clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
        const clonedTreeRoot = clonedSvg.querySelector(
          'g.tree-root',
        ) as SVGGElement | null;
        if (clonedTreeRoot) {
          clonedTreeRoot.removeAttribute('transform');

          // 如果不导出配偶信息，移除克隆 SVG 中的配偶相关元素
          if (!exportSpouse) {
            clonedTreeRoot.querySelectorAll('.spouse-link, .spouse-box, .spouse-label, .spouse-name, .spouse-detail-text').forEach((el) => el.remove());
          }
        }

        exportBBox = treeRoot.getBBox();

        const exportWidth = exportBBox.width + PADDING * 2;
        const exportHeight = exportBBox.height + PADDING * 2;

        clonedSvg.setAttribute('width', String(exportWidth));
        clonedSvg.setAttribute('height', String(exportHeight));
        clonedSvg.setAttribute(
          'viewBox',
          `${exportBBox.x - PADDING} ${exportBBox.y - PADDING} ${exportWidth} ${exportHeight}`,
        );

        // 内联 CSS 样式
        const styleSheets = document.styleSheets;
        let cssText = '';
        try {
          for (const sheet of styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                cssText += rule.cssText + '\n';
              }
            } catch {
              // 跨域样式表跳过
            }
          }
        } catch {
          // ignore
        }
        if (cssText) {
          const styleEl = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'style',
          );
          styleEl.textContent = cssText;
          clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);
        }

        // 添加白色背景矩形
        const bgRect = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'rect',
        );
        bgRect.setAttribute('x', String(exportBBox.x - PADDING));
        bgRect.setAttribute('y', String(exportBBox.y - PADDING));
        bgRect.setAttribute('width', String(exportWidth));
        bgRect.setAttribute('height', String(exportHeight));
        bgRect.setAttribute('fill', '#ffffff');
        clonedSvg.insertBefore(
          bgRect,
          clonedSvg.querySelector('style')?.nextSibling ?? clonedSvg.firstChild,
        );
      }

      setProgress(30);

      // 从 SVG 尺寸获取导出宽高
      const finalWidth = parseFloat(clonedSvg.getAttribute('width') || '800');
      const finalHeight = parseFloat(clonedSvg.getAttribute('height') || '600');

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clonedSvg);
      const svgBlob = new Blob([svgString], {
        type: 'image/svg+xml;charset=utf-8',
      });

      // 生成文件名
      const targetPerson = rawData.find((p) => p.id === targetPersonId);
      const scopeLabel =
        exportScope === 'lineage' && targetPerson
          ? `_${targetPerson.name}直系`
          : '';
      const timestamp = Date.now();

      if (format === 'svg') {
        const url = URL.createObjectURL(svgBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `家谱${scopeLabel}_${timestamp}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        setProgress(100);
        message.success('SVG 导出成功');
      } else {
        // PNG 导出
        const canvas = document.createElement('canvas');
        canvas.width = finalWidth * scale;
        canvas.height = finalHeight * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);

        setProgress(50);

        const img = new Image();
        const url = URL.createObjectURL(svgBlob);

        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = reject;
          img.src = url;
        });

        setProgress(80);

        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              const buffer = await blob.arrayBuffer();
              await api.export.saveImage(
                buffer,
                `家谱${scopeLabel}_${timestamp}.png`,
              );
              message.success('PNG 导出成功');
            } catch {
              // fallback: 浏览器直接下载
              const downloadUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = `家谱${scopeLabel}_${timestamp}.png`;
              a.click();
              URL.revokeObjectURL(downloadUrl);
              message.success('PNG 导出成功');
            }
          }
          setProgress(100);
        }, 'image/png');
      }
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    } finally {
      setTimeout(() => {
        setExporting(false);
        setProgress(0);
      }, 500);
    }
  };

  return (
    <Modal
      title="导出家谱图"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={460}
    >
      <div className="space-y-4 py-2">
        <div>
          <div className="font-medium mb-2">导出格式</div>
          <Radio.Group
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <Radio value="svg">SVG 矢量图</Radio>
            <Radio value="png">PNG 图片</Radio>
          </Radio.Group>
        </div>

        {format === 'png' && (
          <div>
            <div className="font-medium mb-2">分辨率倍数</div>
            <Select
              value={scale}
              onChange={setScale}
              style={{ width: 120 }}
              options={[
                { label: '1x', value: 1 },
                { label: '2x', value: 2 },
                { label: '4x', value: 4 },
              ]}
            />
          </div>
        )}

        <div>
          <div className="font-medium mb-2">导出范围</div>
          <Radio.Group
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value)}
          >
            <Radio value="all">全图</Radio>
            <Radio value="lineage">指定人物直系血脉</Radio>
          </Radio.Group>
        </div>

        <div>
          <Checkbox
            checked={exportSpouse}
            onChange={(e) => setExportSpouse(e.target.checked)}
          >
            导出配偶信息
          </Checkbox>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: '#999',
              lineHeight: 1.5,
              paddingLeft: 24,
            }}
          >
            勾选后将在每个节点旁显示配偶姓名等信息
          </div>
        </div>

        {exportScope === 'lineage' && (
          <div>
            <div className="font-medium mb-2">选择目标人物</div>
            <Select
              showSearch
              value={targetPersonId}
              onChange={setTargetPersonId}
              placeholder="搜索并选择人物"
              style={{ width: '100%' }}
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: '#999',
                lineHeight: 1.5,
              }}
            >
              将从数据库中自动查找该人物的所有直系前代（祖先链）和所有后代，独立渲染并导出，不受当前画布展开状态影响。
            </div>
          </div>
        )}

        {exporting && <Progress percent={progress} size="small" />}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={handleExport}
            loading={exporting}
          >
            开始导出
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ExportDialog;
