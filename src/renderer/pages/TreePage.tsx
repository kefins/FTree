import React, { useRef, useState, useCallback, useEffect } from 'react';
import { message, Empty, Spin, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  EyeOutlined,
  EditOutlined,
  UserAddOutlined,
  TeamOutlined,
  DeleteOutlined,
  NodeExpandOutlined,
} from '@ant-design/icons';
import FamilyTree from '../components/FamilyTree';
import type { LinkStyle } from '../components/FamilyTree';
import TreeToolbar from '../components/TreeToolbar';
import NodeDetail from '../components/NodeDetail';
import ExportDialog from '../components/ExportDialog';
import GenerationColorConfig from '../components/GenerationColorConfig';
import PrintDialog from '../components/PrintDialog';
import { useTreeData } from '../hooks/useTreeData';
import { usePersonCRUD } from '../hooks/usePersonCRUD';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/bridge';
import type { Person } from '../types/person';
import { loadGenerationChars } from '../utils/generationChars';

const TreePage: React.FC = () => {
  const { permissions } = useAuth();
  const {
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
    refresh,
    silentRefresh,
    refreshAndExpand,
  } = useTreeData();

  // 不传 onSuccess 给 usePersonCRUD，避免双重刷新：
  // NodeDetail 在保存/删除后会自行调用 onRefresh / onRefreshAndExpand
  const { create, update, remove } = usePersonCRUD();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [colorConfigVisible, setColorConfigVisible] = useState(false);
  const [colorVersion, setColorVersion] = useState(0);

  // 显示详情/配偶信息/女性成员的控制状态
  const [showDetail, setShowDetail] = useState(false);
  const [showSpouse, setShowSpouse] = useState(false);
  const [showFemale, setShowFemale] = useState(true);
  const [personDetailMap, setPersonDetailMap] = useState<Map<string, Person>>(new Map());
  const [printVisible, setPrintVisible] = useState(false);
  const [linkStyle, setLinkStyle] = useState<LinkStyle>('curve');

  // 辈分字数据
  const [generationChars, setGenerationChars] = useState<Record<number, string>>({});

  // 加载辈分字数据
  useEffect(() => {
    loadGenerationChars()
      .then((data) => setGenerationChars(data.characters || {}))
      .catch(() => {/* 未登录时忽略 */});
  }, []);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    nodeId: string;
  }>({ visible: false, x: 0, y: 0, nodeId: '' });
  /** 右键菜单打开时要进入的初始模式 */
  const [openDetailMode, setOpenDetailMode] = useState<'detail' | 'edit' | 'addChild' | null>(null);

  // 加载完整人员详细数据（用于节点上的"字/号"显示、导出图片等）
  // rawData 变化说明树数据已刷新，需要同步更新 personDetailMap
  useEffect(() => {
    if (rawData && rawData.length > 0) {
      api.data.export().then((result) => {
        const map = new Map<string, Person>();
        const persons = Array.isArray(result) ? result : result.persons || [];
        for (const p of persons) {
          map.set(p.id, p);
        }
        setPersonDetailMap(map);
      }).catch((err) => {
        console.error('加载人员详细数据失败:', err);
      });
    }
  }, [rawData]);

  // 单击节点：仅做祖先链高亮选中，不打开编辑面板
  const handleNodeSelect = useCallback((id: string) => {
    // 如果再次点击已选中的节点，取消选中
    if (selectedId === id) {
      clearSelection();
    } else {
      selectNode(id);
    }
  }, [selectedId, selectNode, clearSelection]);

  // 双击节点：高亮 + 打开详情面板
  const handleNodeDblClick = useCallback((id: string) => {
    setDetailId(id);
    setDetailVisible(true);
    selectNode(id);
  }, [selectNode]);

  // 右键节点：弹出上下文菜单
  const handleNodeContextMenu = useCallback((id: string, x: number, y: number) => {
    selectNode(id);
    setContextMenu({ visible: true, x, y, nodeId: id });
  }, [selectNode]);

  // 关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  const handleZoomIn = useCallback(() => {
    const svg = document.querySelector('.tree-container svg') as any;
    svg?.__zoomIn?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    const svg = document.querySelector('.tree-container svg') as any;
    svg?.__zoomOut?.();
  }, []);

  const handleZoomReset = useCallback(() => {
    const svg = document.querySelector('.tree-container svg') as any;
    svg?.__zoomReset?.();
  }, []);

  const handleSearch = useCallback(
    (name: string) => {
      if (!name.trim()) {
        clearHighlight();
        return;
      }
      const found = findNode(name.trim());
      if (!found) {
        message.info('未找到匹配的成员');
      }
    },
    [findNode, clearHighlight],
  );

  const handleExport = useCallback((format: 'svg' | 'png') => {
    setExportVisible(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailVisible(false);
    setDetailId(null);
    setOpenDetailMode(null);
    // 关闭详情面板时不清除选中高亮（单击选中和面板独立）
  }, []);

  // 保存编辑
  const handleSave = useCallback(
    async (id: string, data: any) => {
      return await update(id, data);
    },
    [update],
  );

  // 添加子女（直接调用 API，不通过 usePersonCRUD.create）
  // 这样避免 usePersonCRUD 的 onSuccess 自动触发 refresh，
  // 而是由 NodeDetail.handleSaveChild 中的 refreshAndExpand 统一刷新，
  // 从而避免双重 fetchData 导致的两次重渲染和视图跳动。
  const handleAddChild = useCallback(
    async (data: any) => {
      try {
        const person = await api.person.create(data);
        return person;
      } catch (err: any) {
        message.error(err?.message || '添加失败');
        return null;
      }
    },
    [],
  );

  // 删除成员
  const handleDelete = useCallback(
    async (id: string) => {
      return await remove(id);
    },
    [remove],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (treeData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty description="暂无家谱数据，请先在编辑管理页面添加成员" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <TreeToolbar
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onExpandToGen={expandToGeneration}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onSearch={handleSearch}
        onExport={handleExport}
        onOpenColorConfig={() => setColorConfigVisible(true)}
        onUnlockAll={unlockAll}
        hasLockedNodes={lockedIds.size > 0}
        showDetail={showDetail}
        onToggleDetail={() => setShowDetail((v) => !v)}
        showFemale={showFemale}
        onToggleFemale={() => setShowFemale((v) => !v)}
        showSpouse={showSpouse}
        onToggleSpouse={() => setShowSpouse((v) => !v)}
        onPrint={() => setPrintVisible(true)}
        linkStyle={linkStyle}
        onLinkStyleChange={setLinkStyle}
      />

      <FamilyTree
        data={treeData}
        adoptionLinks={adoptionLinks}
        onNodeSelect={handleNodeSelect}
        onNodeDblClick={handleNodeDblClick}
        onNodeContextMenu={handleNodeContextMenu}
        highlightId={highlightId}
        selectedId={selectedId}
        ancestorIds={ancestorIds}
        expandedIds={expandedIds}
        lockedIds={lockedIds}
        onToggleNode={toggleNode}
        onToggleLock={toggleLock}
        colorVersion={colorVersion}
        rawData={rawData}
        showDetail={showDetail}
        showSpouse={showSpouse}
        showFemale={showFemale}
        personDetailMap={personDetailMap}
        linkStyle={linkStyle}
        generationChars={generationChars}
        onClickBlank={clearSelection}
      />

      {/* 右键上下文菜单 */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1050,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
            padding: '4px 0',
            minWidth: 160,
            border: '1px solid #f0f0f0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{ padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            className="context-menu-item"
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setDetailId(contextMenu.nodeId);
              setOpenDetailMode(null);
              setDetailVisible(true);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <EyeOutlined style={{ color: '#1677ff' }} />
            <span>查看详情</span>
          </div>
          {permissions.canEdit && (
          <div
            style={{ padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            className="context-menu-item"
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setDetailId(contextMenu.nodeId);
              setOpenDetailMode('edit');
              setDetailVisible(true);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <EditOutlined style={{ color: '#52c41a' }} />
            <span>编辑信息</span>
          </div>
          )}
          <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
          {permissions.canEdit && (
          <div
            style={{ padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            className="context-menu-item"
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setDetailId(contextMenu.nodeId);
              setOpenDetailMode('addChild');
              setDetailVisible(true);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <UserAddOutlined style={{ color: '#1677ff' }} />
            <span>添加子女</span>
          </div>
          )}
          <div
            style={{ padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            className="context-menu-item"
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setDetailId(contextMenu.nodeId);
              setOpenDetailMode(null);
              setDetailVisible(true);
              setContextMenu((prev) => ({ ...prev, visible: false }));
              // 子女列表需要在面板打开后手动触发，这里先打开详情
            }}
          >
            <TeamOutlined style={{ color: '#722ed1' }} />
            <span>查看子女</span>
          </div>
          <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
          <div
            style={{ padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            className="context-menu-item"
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              expandDescendants(contextMenu.nodeId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <NodeExpandOutlined style={{ color: '#13c2c2' }} />
            <span>展开所有后代</span>
          </div>
        </div>
      )}

      <NodeDetail
        personId={detailId}
        visible={detailVisible}
        onClose={handleCloseDetail}
        onViewChildren={(id) => {
          // 当从子女列表点击某个子女时，切换详情到该子女
          setDetailId(id);
          setOpenDetailMode(null);
          // 同时更新选中状态以触发祖先高亮
          selectNode(id);
        }}
        rawData={rawData}
        treeData={treeData}
        onSave={permissions.canEdit ? handleSave : undefined}
        onAddChild={permissions.canEdit ? handleAddChild : undefined}
        onDelete={permissions.canDelete ? handleDelete : undefined}
        onRefresh={silentRefresh}
        onRefreshAndExpand={refreshAndExpand}
        initialMode={openDetailMode}
        generationChars={generationChars}
      />

      <ExportDialog
        visible={exportVisible}
        onClose={() => setExportVisible(false)}
        svgRef={svgRef}
        rawData={rawData}
        treeData={treeData}
        selectedId={selectedId}
        personDetailMap={personDetailMap}
        generationChars={generationChars}
      />

      <GenerationColorConfig
        visible={colorConfigVisible}
        onClose={() => setColorConfigVisible(false)}
        onSave={() => setColorVersion((v) => v + 1)}
      />

      <PrintDialog
        visible={printVisible}
        onClose={() => setPrintVisible(false)}
        treeData={treeData}
        rawData={rawData}
        personDetailMap={personDetailMap}
        selectedId={selectedId}
      />
    </div>
  );
};

export default TreePage;
