import React, { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNode, AdoptionLink, PersonIndex, Person } from '../types/person';
import { getGenerationColors, getGenderedColor, type GenerationColorItem } from '../utils/generationColors';
import { getBirthOrderInfo } from '../utils/birthOrder';

/** 连线样式类型 */
export type LinkStyle = 'curve' | 'straight' | 'elbow';

interface FamilyTreeProps {
  data: TreeNode[];
  adoptionLinks?: AdoptionLink[];
  /** @deprecated 请使用 onNodeSelect（单击高亮）和 onNodeDblClick（双击打开详情） */
  onNodeClick?: (id: string) => void;
  /** 单击节点回调：仅做高亮选中，不打开编辑面板 */
  onNodeSelect?: (id: string) => void;
  /** 双击节点回调：打开详情/编辑面板 */
  onNodeDblClick?: (id: string) => void;
  /** 右键节点回调：弹出上下文菜单 */
  onNodeContextMenu?: (id: string, x: number, y: number) => void;
  highlightId?: string | null;
  /** 当前选中的节点 ID（用于高亮选中节点） */
  selectedId?: string | null;
  /** 选中节点的所有祖先 ID 集合（用于高亮直系祖先链） */
  ancestorIds?: Set<string>;
  expandedIds?: Set<string>;
  /** 被锁定的节点 ID 集合 */
  lockedIds?: Set<string>;
  onToggleNode?: (id: string) => void;
  /** 锁定/解锁节点回调 */
  onToggleLock?: (id: string) => void;
  /** 颜色配置版本号，变化时触发重新渲染 */
  colorVersion?: number;
  /** 扁平化的所有人员索引数据（用于排行计算） */
  rawData?: PersonIndex[];
  /** 是否显示个人详细信息（出生年月等） */
  showDetail?: boolean;
  /** 是否显示配偶详细信息 */
  showSpouse?: boolean;
  /** 所有人员详细数据的映射（用于显示详细信息） */
  personDetailMap?: Map<string, Person>;
  /** 连线样式：曲线(curve)、直线(straight)、折线(elbow) */
  linkStyle?: LinkStyle;
  /** 辈分字映射：世数 → 辈分字 */
  generationChars?: Record<number, string>;
  /** 点击空白区域回调（用于取消选中） */
  onClickBlank?: () => void;
}

interface HierarchyNode {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  spouseName?: string;
  children?: HierarchyNode[];
  _hasChildren: boolean;
  _isAdopted: boolean;
  /** 排行标签（如"老大·长子"） */
  _orderLabel?: string;
  /** 是否为占位空节点（无父辈时自动生成） */
  _isPlaceholder?: boolean;
  /** 个人详细信息（出生日期、地点等） */
  _birthDate?: string;
  _deathDate?: string;
  _birthPlace?: string;
  _occupation?: string;
  _bio?: string;
  /** 配偶详细信息 */
  _spouseBirthDate?: string;
  _spouseDeathDate?: string;
  _spouseBirthPlace?: string;
  _spouseOccupation?: string;
  _spousePhone?: string;
  _spouseAddress?: string;
  /** 子女备注（女性成员用） */
  _childrenNote?: string;
}

const BASE_NODE_WIDTH = 120;
const BASE_NODE_HEIGHT = 76;
const H_SPACING = 40;
const V_SPACING = 100;

/** 配偶框尺寸常量（比主角色框更小巧紧凑） */
const SPOUSE_BOX_W = 80;
const SPOUSE_BOX_H = 52;
const SPOUSE_GAP = 6; // 主节点与配偶框之间的连接线长度

/** 根据显示模式计算节点实际尺寸（包含配偶框占用的额外宽度） */
function getNodeSize(showDetail: boolean, showSpouse: boolean): { width: number; height: number } {
  let w = BASE_NODE_WIDTH;
  let h = BASE_NODE_HEIGHT;
  if (showDetail) {
    w = Math.max(w, 150);
    h += 52; // 出生、逝世、籍贯、职业各约13px
  }
  if (showSpouse) {
    w = Math.max(w, 150);
  }
  return { width: w, height: h };
}

/** 获取配偶框占用的额外宽度（需要加到节点间距中，防止配偶框与相邻节点重叠） */
function getSpouseExtraWidth(showSpouse: boolean): number {
  if (!showSpouse) return 0;
  return SPOUSE_GAP + SPOUSE_BOX_W;
}

function filterByExpanded(
  nodes: TreeNode[],
  expandedIds: Set<string>,
  adoptedIds?: Set<string>,
  rawData?: PersonIndex[],
  personDetailMap?: Map<string, Person>,
): HierarchyNode[] {
  return nodes.map((node) => {
    const isPlaceholder = node.id.startsWith('__placeholder__');

    // 计算排行标签（占位节点不需要）
    let orderLabel: string | undefined;
    if (!isPlaceholder && rawData && rawData.length > 0) {
      const personData = rawData.find((p) => p.id === node.id);
      const isAdopted = personData?.biologicalParentId && personData.biologicalParentId !== personData.parentId;
      // 树上的节点按 parentId 挂载，所以默认用 auto（被过继的人按养父排行）
      const orderInfo = getBirthOrderInfo(node.id, rawData);
      if (orderInfo) {
        orderLabel = `${orderInfo.unifiedLabel}·${orderInfo.genderedLabel}`;
        // 被过继的人额外显示亲生排行
        if (isAdopted) {
          const bioOrder = getBirthOrderInfo(node.id, rawData, 'biological');
          if (bioOrder) {
            orderLabel += ` (生${bioOrder.unifiedLabel})`;
          }
        }
      }
    }

    // 从 personDetailMap 中提取详细信息
    const detail = personDetailMap?.get(node.id);

    return {
      id: node.id,
      name: node.name,
      gender: node.gender,
      generation: node.generation,
      spouseName: node.spouseName,
      _hasChildren: node.children.length > 0,
      _isAdopted: adoptedIds?.has(node.id) ?? false,
      _orderLabel: orderLabel,
      _isPlaceholder: isPlaceholder,
      // 填充详细信息
      _birthDate: detail?.birthDate,
      _deathDate: detail?.deathDate,
      _birthPlace: detail?.birthPlace,
      _occupation: detail?.occupation,
      _bio: detail?.bio,
      // 配偶详细信息：现在 Person 记录中有独立的配偶字段
      _spouseBirthDate: detail?.spouseBirthDate,
      _spouseDeathDate: detail?.spouseDeathDate,
      _spouseBirthPlace: detail?.spouseBirthPlace,
      _spouseOccupation: detail?.spouseOccupation,
      _spousePhone: detail?.spousePhone,
      _spouseAddress: detail?.spouseAddress,
      _childrenNote: detail?.childrenNote,
      children:
        // 占位节点和真实节点都按 expandedIds 控制展开/折叠
        expandedIds.has(node.id) && node.children.length > 0
          ? filterByExpanded(node.children, expandedIds, adoptedIds, rawData, personDetailMap)
          : undefined,
    };
  });
}

const FamilyTree: React.FC<FamilyTreeProps> = ({
  data,
  adoptionLinks = [],
  onNodeClick,
  onNodeSelect,
  onNodeDblClick,
  onNodeContextMenu,
  highlightId,
  selectedId,
  ancestorIds = new Set(),
  expandedIds = new Set(),
  lockedIds = new Set(),
  onToggleNode,
  onToggleLock,
  colorVersion,
  rawData = [],
  showDetail = false,
  showSpouse = false,
  personDetailMap,
  linkStyle = 'curve',
  generationChars = {},
  onClickBlank,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  /** 根据连线样式生成 SVG path 的 d 属性 */
  const buildLinkPath = useCallback(
    (sx: number, sy: number, tx: number, ty: number): string => {
      const my = (sy + ty) / 2;
      switch (linkStyle) {
        case 'straight':
          // 直线：直接从起点到终点
          return `M${sx},${sy} L${tx},${ty}`;
        case 'elbow':
          // 折线：先竖直到中点，再水平偏移，再竖直到终点
          return `M${sx},${sy} L${sx},${my} L${tx},${my} L${tx},${ty}`;
        case 'curve':
        default:
          // 贝塞尔曲线（原有样式）
          return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
      }
    },
    [linkStyle],
  );

  const renderTree = useCallback(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // 根据显示模式计算动态节点尺寸
    const { width: NODE_WIDTH, height: NODE_HEIGHT } = getNodeSize(showDetail, showSpouse);

    // 获取世代颜色配置
    const genColors = getGenerationColors();
    const getColor = (gen: number): GenerationColorItem => {
      const idx = ((gen - 1) % genColors.length + genColors.length) % genColors.length;
      return genColors[idx];
    };
    /** 获取考虑性别差异的节点颜色 */
    const getNodeColor = (gen: number, gender: 'male' | 'female'): GenerationColorItem => {
      return getGenderedColor(getColor(gen), gender);
    };

    // 清除旧内容
    svg.selectAll('g.tree-root').remove();

    // 根据展开状态过滤
    const adoptedIds = new Set(adoptionLinks.map((l) => l.childId));
    const visibleData = filterByExpanded(data, expandedIds, adoptedIds, rawData, personDetailMap);

    if (visibleData.length === 0) return;

    // 虚拟根节点（多根合并）
    const virtualRoot: HierarchyNode =
      visibleData.length === 1
        ? visibleData[0]
        : {
            id: '__root__',
            name: '',
            gender: 'male',
            generation: 0,
            _hasChildren: true,
            _isAdopted: false,
            children: visibleData,
          };

    const root = d3.hierarchy(virtualRoot);

    const spouseExtra = getSpouseExtraWidth(showSpouse);
    const treeLayout = d3
      .tree<HierarchyNode>()
      .nodeSize([NODE_WIDTH + spouseExtra + H_SPACING, NODE_HEIGHT + V_SPACING]);

    treeLayout(root);

    // ====== 按 generation（世数）对齐 Y 坐标 ======
    // d3.tree() 按树深度分配 y 坐标，但不同分支的同一世数可能处于不同深度，
    // 导致同一世代的人不在同一水平线上。这里根据 generation 强制对齐。
    {
      const allNodes = root.descendants();
      // 1. 收集每个 generation 的最大 y 值（取同世代中最深的 y）
      const genMaxY = new Map<number, number>();
      for (const n of allNodes) {
        if (n.data.id === '__root__') continue;
        const gen = n.data.generation;
        const curMax = genMaxY.get(gen);
        if (curMax === undefined || n.y! > curMax) {
          genMaxY.set(gen, n.y!);
        }
      }
      // 2. 确保世数从小到大，y 坐标严格递增
      const sortedGens = Array.from(genMaxY.keys()).sort((a, b) => a - b);
      const genY = new Map<number, number>();
      const rowHeight = NODE_HEIGHT + V_SPACING;
      for (let i = 0; i < sortedGens.length; i++) {
        const gen = sortedGens[i];
        if (i === 0) {
          // 第一世使用自身的 y 或 0
          genY.set(gen, genMaxY.get(gen)!);
        } else {
          const prevGen = sortedGens[i - 1];
          const prevY = genY.get(prevGen)!;
          // 当前世的 y 必须 >= 上一世 y + rowHeight
          const candidateY = Math.max(genMaxY.get(gen)!, prevY + rowHeight);
          genY.set(gen, candidateY);
        }
      }
      // 3. 将所有节点的 y 坐标统一为其 generation 对应的 y
      for (const n of allNodes) {
        if (n.data.id === '__root__') continue;
        const targetY = genY.get(n.data.generation);
        if (targetY !== undefined) {
          n.y = targetY;
        }
      }
    }

    const g = svg.append('g').attr('class', 'tree-root');
    gRef.current = g.node();

    // 计算平移居中（仅用于首次初始化）
    const nodes = root.descendants();
    const minX = d3.min(nodes, (d) => d.x!) || 0;
    const maxX = d3.max(nodes, (d) => d.x!) || 0;
    const treeWidth = maxX - minX;
    const offsetX = width / 2 - treeWidth / 2 - minX;
    const offsetY = 60;

    // 如果 zoom 已初始化（非首次渲染），使用当前的 zoom transform 保持视图位置不变
    // 这样单击选中节点等操作不会导致画面跳回初始居中位置
    if (zoomRef.current) {
      const currentTransform = d3.zoomTransform(svg.node()!);
      g.attr('transform', currentTransform.toString());
    } else {
      g.attr('transform', `translate(${offsetX}, ${offsetY})`);
    }

    // 绘制连接线
    const linksData = root.links().filter((l) => l.source.data.id !== '__root__' || visibleData.length > 1);
    g.selectAll('.tree-link')
      .data(linksData)
      .enter()
      .append('path')
      .attr('class', (d) => {
        let cls = 'tree-link';
        // 如果这条连线连接的是选中节点或祖先链上的节点，添加高亮类名
        const sourceId = d.source.data.id;
        const targetId = d.target.data.id;
        const isAncestorLink = 
          (selectedId && (targetId === selectedId || ancestorIds.has(targetId))) &&
          (ancestorIds.has(sourceId) || sourceId === '__root__');
        if (isAncestorLink) {
          cls += ' tree-link-ancestor';
        } else if (selectedId) {
          // 有选中节点时，非祖先链连线淡化
          cls += ' tree-link-dimmed';
        }
        return cls;
      })
      .attr('d', (d) => {
        const sx = d.source.x!;
        const sy = d.source.y! + NODE_HEIGHT / 2;
        const tx = d.target.x!;
        const ty = d.target.y! - NODE_HEIGHT / 2;
        return buildLinkPath(sx, sy, tx, ty);
      })
      .attr('data-source', (d) => d.source.data.id)
      .attr('data-target', (d) => d.target.data.id)
      .each(function (d) {
        // 如果连线涉及占位节点，使用虚线样式
        const isPlaceholderLink =
          d.source.data._isPlaceholder || d.target.data._isPlaceholder;
        if (isPlaceholderLink) {
          d3.select(this)
            .style('stroke-dasharray', '6,4')
            .style('opacity', '0.5');
        }
      });

    // 绘制节点
    const nodeGroup = g
      .selectAll('.tree-node')
      .data(
        nodes.filter((d) => d.data.id !== '__root__'),
      )
      .enter()
      .append('g')
      .attr('class', (d) => {
        let cls = `tree-node tree-node-${d.data.gender}`;
        if (highlightId && d.data.id === highlightId) {
          cls += ' tree-node-highlight';
        }
        if (selectedId && d.data.id === selectedId) {
          cls += ' tree-node-selected';
        } else if (ancestorIds.has(d.data.id)) {
          cls += ' tree-node-ancestor';
        } else if (selectedId) {
          // 有选中节点时，非关联节点淡化
          cls += ' tree-node-dimmed';
        }
        return cls;
      })
      .attr('transform', (d) => `translate(${d.x! - NODE_WIDTH / 2}, ${d.y! - NODE_HEIGHT / 2})`)
      .attr('data-id', (d) => d.data.id)
      .on('click', (_event, d) => {
        _event.stopPropagation();
        // 占位节点不触发点击
        if (!d.data._isPlaceholder) {
          // 单击：仅高亮选中节点及其祖先链，不打开编辑面板
          if (onNodeSelect) {
            onNodeSelect(d.data.id);
          } else {
            // 兼容旧的 onNodeClick 回调
            onNodeClick?.(d.data.id);
          }
        }
      })
      .on('dblclick', (event, d) => {
        // 阻止事件冒泡到 SVG，防止 d3.zoom 的双击缩放行为
        event.stopPropagation();
        event.preventDefault();
        // 占位节点不触发双击
        if (!d.data._isPlaceholder) {
          // 双击：打开详情/编辑面板
          onNodeDblClick?.(d.data.id);
        }
      })
      .on('contextmenu', (event, d) => {
        // 占位节点不触发右键菜单
        if (!d.data._isPlaceholder) {
          event.preventDefault();
          event.stopPropagation();
          // 右键：弹出上下文菜单
          onNodeContextMenu?.(d.data.id, event.pageX, event.pageY);
        }
      })
      .on('mouseenter', (event, d) => {
        if (tooltipRef.current) {
          if (d.data._isPlaceholder) {
            tooltipRef.current.textContent = `第${d.data.generation}世 - 未录入（占位节点）`;
          } else {
            const adoptTag = d.data._isAdopted ? ' [过继]' : '';
            const spouseTag = d.data.spouseName ? ` | 配偶: ${d.data.spouseName}` : '';
            const orderTag = d.data._orderLabel ? ` | ${d.data._orderLabel}` : '';
            tooltipRef.current.textContent = `${d.data.name} - 第${d.data.generation}世${orderTag}${adoptTag}${spouseTag}`;
          }
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${event.pageX}px`;
          tooltipRef.current.style.top = `${event.pageY - 10}px`;
        }
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      });

    // 节点矩形（按世数着色，占位节点用虚线框）
    nodeGroup
      .append('rect')
      .attr('width', NODE_WIDTH)
      .attr('height', NODE_HEIGHT)
      .attr('rx', 8)
      .attr('ry', 8)
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        const sel = d3.select(this);
        if (d.data._isPlaceholder) {
          // 占位节点：虚线边框、半透明背景
          sel
            .style('fill', 'rgba(200, 200, 200, 0.15)')
            .style('stroke', '#bbb')
            .style('stroke-width', '1.5px')
            .style('stroke-dasharray', '6,3')
            .style('opacity', '0.7');
        } else {
          sel
            .style('fill', c.bg)
            .style('stroke', c.border)
            .style('stroke-width', '2px')
            .style('filter', 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.1))');
        }
        // 锁定节点：添加金色边框
        if (lockedIds.has(d.data.id)) {
          sel
            .style('stroke', '#f57c00')
            .style('stroke-width', '2.5px')
            .style('stroke-dasharray', 'none');
        }
      });

    // 锁定节点左上角小锁图标
    nodeGroup
      .filter((d) => lockedIds.has(d.data.id))
      .append('text')
      .attr('class', 'node-lock-icon')
      .attr('x', 4)
      .attr('y', 14)
      .style('font-size', '11px')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .text('🔒');

    // 性别小图标（节点左上角，非占位节点显示）
    nodeGroup
      .filter((d) => !d.data._isPlaceholder)
      .append('text')
      .attr('class', 'node-gender-icon')
      .attr('x', NODE_WIDTH - 16)
      .attr('y', 14)
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .style('opacity', '0.7')
      .text((d) => d.data.gender === 'male' ? '♂' : '♀')
      .each(function (d) {
        const color = d.data.gender === 'male' ? '#1677ff' : '#eb2f96';
        d3.select(this).style('fill', color);
      });

    // 姓名（showDetail 时上移更多以留出详情空间）
    const nameBaseY = showDetail ? 24 : NODE_HEIGHT / 2 - 6;
    nodeGroup
      .append('text')
      .attr('class', 'node-name')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', nameBaseY)
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        const sel = d3.select(this);
        if (d.data._isPlaceholder) {
          // 占位节点显示"佚名"
          sel
            .style('fill', '#999')
            .style('opacity', '0.6')
            .style('font-style', 'italic')
            .text('佚名');
        } else {
          sel
            .style('fill', c.text)
            .text(() => {
              const name = d.data.name;
              return name.length > 6 ? name.slice(0, 6) + '…' : name;
            });
        }
      });

    // 排行小字（姓名下方）
    nodeGroup
      .filter((d) => !!d.data._orderLabel)
      .append('text')
      .attr('class', 'node-order-label')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', nameBaseY + 18)
      .each(function (d) {
        const c = getNodeColor(d.data.generation, d.data.gender);
        d3.select(this)
          .style('fill', c.text)
          .style('opacity', '0.55')
          .text(d.data._orderLabel!);
      });

    // 个人详细信息（showDetail 模式下在排行之后渲染）
    if (showDetail) {
      const detailStartY = nameBaseY + 34; // 详情起始 Y 坐标
      const detailLineH = 13; // 每行高度

      // 出生日期
      nodeGroup
        .filter((d) => !d.data._isPlaceholder && !!d.data._birthDate)
        .append('text')
        .attr('class', 'node-detail-text')
        .attr('x', NODE_WIDTH / 2)
        .attr('y', detailStartY)
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.6')
            .text(`生: ${d.data._birthDate}`);
        });

      // 逝世日期
      nodeGroup
        .filter((d) => !d.data._isPlaceholder && !!d.data._deathDate)
        .append('text')
        .attr('class', 'node-detail-text')
        .attr('x', NODE_WIDTH / 2)
        .attr('y', detailStartY + detailLineH)
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.6')
            .text(`殁: ${d.data._deathDate}`);
        });

      // 籍贯
      nodeGroup
        .filter((d) => !d.data._isPlaceholder && !!d.data._birthPlace)
        .append('text')
        .attr('class', 'node-detail-text')
        .attr('x', NODE_WIDTH / 2)
        .attr('y', detailStartY + detailLineH * 2)
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          const place = d.data._birthPlace || '';
          const displayPlace = place.length > 8 ? place.slice(0, 8) + '…' : place;
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.6')
            .text(`籍: ${displayPlace}`);
        });

      // 职业
      nodeGroup
        .filter((d) => !d.data._isPlaceholder && !!d.data._occupation)
        .append('text')
        .attr('class', 'node-detail-text')
        .attr('x', NODE_WIDTH / 2)
        .attr('y', detailStartY + detailLineH * 3)
        .each(function (d) {
          const c = getNodeColor(d.data.generation, d.data.gender);
          const occ = d.data._occupation || '';
          const displayOcc = occ.length > 8 ? occ.slice(0, 8) + '…' : occ;
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.6')
            .text(`业: ${displayOcc}`);
        });
    }

    // 女性成员子女备注（显示在节点底部，不依赖 showDetail）
    nodeGroup
      .filter((d) => !d.data._isPlaceholder && d.data.gender === 'female' && !!d.data._childrenNote)
      .append('text')
      .attr('class', 'node-detail-text')
      .attr('x', NODE_WIDTH / 2)
      .attr('y', NODE_HEIGHT - 6)
      .each(function (d) {
        const note = d.data._childrenNote || '';
        const displayNote = note.length > 8 ? note.slice(0, 8) + '…' : note;
        d3.select(this)
          .style('fill', '#eb2f96')
          .style('opacity', '0.7')
          .style('font-size', '9px')
          .text(`子女: ${displayNote}`);
      });

    // 配偶小框（附着在节点右侧，仅在 showSpouse 模式下显示）
    if (showSpouse) {
      // Debug: 打印有配偶数据的节点
      const nodesWithSpouse = nodes.filter((d) => d.data.id !== '__root__' && d.data.spouseName);
      if (nodesWithSpouse.length > 0) {
        console.log('[FamilyTree] 有配偶数据的节点:', nodesWithSpouse.map((d) => `${d.data.name}→${d.data.spouseName}`));
      }

      const spouseNodes = nodeGroup.filter((d) => !!d.data.spouseName);

      // 连接短线（从节点右边缘到配偶框左边缘）
      spouseNodes
        .append('line')
        .attr('class', 'spouse-link')
        .attr('x1', NODE_WIDTH)
        .attr('y1', NODE_HEIGHT / 2)
        .attr('x2', NODE_WIDTH + SPOUSE_GAP)
        .attr('y2', NODE_HEIGHT / 2);

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
          const c = getColor(d.data.generation);
          d3.select(this)
            .style('fill', c.bg)
            .style('stroke', c.border)
            .style('stroke-width', '1.5px')
            .style('stroke-dasharray', '4,2')
            .style('opacity', '0.85')
            .style('filter', 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.06))');
        });

      // 配偶框中的"配偶"小标签（更小字号）
      spouseNodes
        .append('text')
        .attr('class', 'spouse-label')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 11)
        .style('font-size', '9px')
        .each(function (d) {
          const c = getColor(d.data.generation);
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.55')
            .text('配偶');
        });

      // 配偶框中的姓名（稍小字号）
      spouseNodes
        .append('text')
        .attr('class', 'spouse-name')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 24)
        .style('font-size', '11px')
        .each(function (d) {
          const c = getColor(d.data.generation);
          const spouseName = d.data.spouseName!;
          const displayName = spouseName.length > 4 ? spouseName.slice(0, 4) + '…' : spouseName;
          d3.select(this)
            .style('fill', c.text)
            .style('font-weight', '600')
            .text(displayName);
        });

      // 配偶详细信息（更紧凑布局，更小字号）
      // 老家住址
      spouseNodes
        .filter((d) => !!d.data._spouseBirthPlace)
        .append('text')
        .attr('class', 'spouse-detail-text')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 37)
        .style('font-size', '8px')
        .each(function (d) {
          const c = getColor(d.data.generation);
          const place = d.data._spouseBirthPlace || '';
          const displayPlace = place.length > 5 ? place.slice(0, 5) + '…' : place;
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.65')
            .text(`📍${displayPlace}`);
        });

      // 职业
      spouseNodes
        .filter((d) => !!d.data._spouseOccupation)
        .append('text')
        .attr('class', 'spouse-detail-text')
        .attr('x', NODE_WIDTH + SPOUSE_GAP + SPOUSE_BOX_W / 2)
        .attr('y', (NODE_HEIGHT - SPOUSE_BOX_H) / 2 + 48)
        .style('font-size', '8px')
        .each(function (d) {
          const c = getColor(d.data.generation);
          const occ = d.data._spouseOccupation || '';
          const displayOcc = occ.length > 5 ? occ.slice(0, 5) + '…' : occ;
          d3.select(this)
            .style('fill', c.text)
            .style('opacity', '0.55')
            .text(`💼${displayOcc}`);
        });
    }

    // 在每一世的行首绘制世代标签
    const generationYMap = new Map<number, number>();
    for (const n of nodes) {
      if (n.data.id === '__root__') continue;
      const gen = n.data.generation;
      if (!generationYMap.has(gen)) {
        generationYMap.set(gen, n.y!);
      }
    }

    // 计算所有可见节点的最左侧 x 坐标
    const allVisibleNodes = nodes.filter((d) => d.data.id !== '__root__');
    const minNodeX = d3.min(allVisibleNodes, (d) => d.x!) || 0;
    const labelX = minNodeX - NODE_WIDTH / 2 - 60; // 标签放在最左侧节点再往左

    for (const [gen, yPos] of generationYMap.entries()) {
      const c = getColor(gen);
      const genChar = generationChars[gen];
      const labelText = genChar ? `${gen}世·${genChar}` : `${gen}世`;
      const labelWidth = genChar ? 64 : 48;

      // 世代标签背景
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

      // 世代标签文字
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

    // 过继标记（右上角小标签）
    const adoptedNodes = nodeGroup.filter((d) => d.data._isAdopted);
    adoptedNodes
      .append('rect')
      .attr('class', 'node-adopted-badge')
      .attr('x', NODE_WIDTH - 24)
      .attr('y', -4)
      .attr('width', 28)
      .attr('height', 16)
      .attr('rx', 3)
      .attr('ry', 3);
    adoptedNodes
      .append('text')
      .attr('class', 'node-adopted-text')
      .attr('x', NODE_WIDTH - 10)
      .attr('y', 5)
      .text('继');

    // 展开/折叠按钮（占位节点也可折叠）
    const expandableNodes = nodes.filter(
      (d) => d.data.id !== '__root__' && d.data._hasChildren,
    );

    const btnGroup = g
      .selectAll('.tree-expand-btn')
      .data(expandableNodes)
      .enter()
      .append('g')
      .attr('class', 'tree-expand-btn')
      .attr('data-id', (d) => d.data.id)
      .attr('transform', (d) => `translate(${d.x!}, ${d.y! + NODE_HEIGHT / 2 + 12})`)
      .on('click', (event, d) => {
        event.stopPropagation();
        onToggleNode?.(d.data.id);
      });

    btnGroup.append('circle').attr('r', 10);

    btnGroup
      .append('text')
      .text((d) => (expandedIds.has(d.data.id) ? '−' : '+'));

    // 锁定按钮（在展开/折叠按钮右侧）
    const lockBtnGroup = g
      .selectAll('.tree-lock-btn')
      .data(expandableNodes)
      .enter()
      .append('g')
      .attr('class', 'tree-lock-btn')
      .attr('data-id', (d) => d.data.id)
      .attr('transform', (d) => `translate(${d.x! + 18}, ${d.y! + NODE_HEIGHT / 2 + 12})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        onToggleLock?.(d.data.id);
      });

    lockBtnGroup
      .append('circle')
      .attr('r', 8)
      .style('fill', (d) => lockedIds.has(d.data.id) ? '#fff3e0' : 'rgba(255,255,255,0.85)')
      .style('stroke', (d) => lockedIds.has(d.data.id) ? '#f57c00' : '#ccc')
      .style('stroke-width', '1.2px');

    lockBtnGroup
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('font-size', '9px')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .text((d) => lockedIds.has(d.data.id) ? '🔒' : '🔓');

    // 绘制过继关系虚线（亲生父亲 → 过继子女）
    if (adoptionLinks.length > 0) {
      // 建立 id → 节点位置映射
      const nodePositions = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        if (n.data.id !== '__root__') {
          nodePositions.set(n.data.id, { x: n.x!, y: n.y! });
        }
      }

      const visibleLinks = adoptionLinks.filter(
        (link) => nodePositions.has(link.childId) && nodePositions.has(link.biologicalParentId),
      );

      for (const link of visibleLinks) {
        const parent = nodePositions.get(link.biologicalParentId)!;
        const child = nodePositions.get(link.childId)!;

        const sx = parent.x;
        const sy = parent.y + NODE_HEIGHT / 2;
        const tx = child.x;
        const ty = child.y - NODE_HEIGHT / 2;

        g.append('path')
          .attr('class', 'tree-link-adoption')
          .attr('d', buildLinkPath(sx, sy, tx, ty));
      }
    }

    // 缩放
    if (!zoomRef.current) {
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 3])
        .on('zoom', (event) => {
          if (gRef.current) {
            d3.select(gRef.current).attr('transform', event.transform);
          }
        });
      zoomRef.current = zoom;
      svg.call(zoom);
      // 禁用 D3 默认的双击缩放行为，避免与节点双击事件冲突
      svg.on('dblclick.zoom', null);

      // 初始缩放
      const initialTransform = d3.zoomIdentity.translate(offsetX, offsetY);
      svg.call(zoom.transform, initialTransform);
    }

    // 空白点击取消选中的逻辑已移到独立 useEffect 中（见下方）
  }, [data, adoptionLinks, expandedIds, lockedIds, highlightId, selectedId, ancestorIds, onNodeClick, onNodeSelect, onNodeDblClick, onNodeContextMenu, onToggleNode, onToggleLock, colorVersion, rawData, showDetail, showSpouse, personDetailMap, buildLinkPath, generationChars]);

  useEffect(() => {
    renderTree();
  }, [renderTree]);

  // ★ 独立的空白区域点击检测
  // 关键：D3 zoom 会在 click 事件中调用 stopImmediatePropagation()，
  // 导致 D3 的 svg.on('click.blank') 永远不会触发。
  // 解决方案：使用原生 addEventListener 在 capture 阶段监听 pointerdown/pointerup，
  // 这些事件不受 D3 zoom click 拦截的影响。
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    let startPos: { x: number; y: number } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      startPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!startPos) return;
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      startPos = null;

      // 仅在短距离移动时（排除拖拽平移）
      if (dist >= 5) return;

      // 检查点击目标是否在节点或按钮内部
      const target = e.target as Element;
      if (!target) return;
      const isOnInteractive =
        target.closest('.tree-node') ||
        target.closest('.tree-expand-btn') ||
        target.closest('.tree-lock-btn');
      if (!isOnInteractive) {
        onClickBlank?.();
      }
    };

    // 使用 capture 阶段确保在 D3 处理之前接收事件
    svgEl.addEventListener('pointerdown', handlePointerDown, true);
    svgEl.addEventListener('pointerup', handlePointerUp, true);

    return () => {
      svgEl.removeEventListener('pointerdown', handlePointerDown, true);
      svgEl.removeEventListener('pointerup', handlePointerUp, true);
    };
  }, [onClickBlank]);

  // 暴露缩放方法
  const zoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 1.3);
    }
  }, []);

  const zoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 0.7);
    }
  }, []);

  const zoomReset = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }, []);

  // 通过 ref 暴露方法
  useEffect(() => {
    const el = svgRef.current;
    if (el) {
      (el as any).__zoomIn = zoomIn;
      (el as any).__zoomOut = zoomOut;
      (el as any).__zoomReset = zoomReset;
    }
  }, [zoomIn, zoomOut, zoomReset]);

  return (
    <div className="tree-container">
      <svg ref={svgRef} />
      <div
        ref={tooltipRef}
        className="tree-tooltip"
        style={{ display: 'none', position: 'fixed' }}
      />
    </div>
  );
};

export default FamilyTree;
