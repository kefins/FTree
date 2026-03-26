import React from 'react';
import { Button, Select, Input, Dropdown, Space, Tooltip, Segmented } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  AimOutlined,
  DownloadOutlined,
  FileImageOutlined,
  PictureOutlined,
  BgColorsOutlined,
  NodeExpandOutlined,
  NodeCollapseOutlined,
  UnlockOutlined,
  IdcardOutlined,
  TeamOutlined,
  PrinterOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import type { LinkStyle } from './FamilyTree';

const { Search } = Input;

interface TreeToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onExpandToGen: (gen: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onSearch: (name: string) => void;
  onExport: (format: 'svg' | 'png') => void;
  onOpenColorConfig?: () => void;
  onUnlockAll?: () => void;
  hasLockedNodes?: boolean;
  /** 是否显示个人详细信息 */
  showDetail?: boolean;
  onToggleDetail?: () => void;
  /** 是否显示配偶信息 */
  showSpouse?: boolean;
  onToggleSpouse?: () => void;
  /** 打印回调 */
  onPrint?: () => void;
  /** 当前连线样式 */
  linkStyle?: LinkStyle;
  /** 切换连线样式回调 */
  onLinkStyleChange?: (style: LinkStyle) => void;
}

const genOptions = Array.from({ length: 10 }, (_, i) => ({
  label: `展开到第${i + 1}世`,
  value: i + 1,
}));

const TreeToolbar: React.FC<TreeToolbarProps> = ({
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onExpandToGen,
  onExpandAll,
  onCollapseAll,
  onSearch,
  onExport,
  onOpenColorConfig,
  onUnlockAll,
  hasLockedNodes,
  showDetail = false,
  onToggleDetail,
  showSpouse = false,
  onToggleSpouse,
  onPrint,
  linkStyle = 'curve',
  onLinkStyleChange,
}) => {
  const exportItems = [
    {
      key: 'svg',
      label: 'SVG 矢量图',
      icon: <FileImageOutlined />,
      onClick: () => onExport('svg'),
    },
    {
      key: 'png',
      label: 'PNG 图片',
      icon: <PictureOutlined />,
      onClick: () => onExport('png'),
    },
  ];

  return (
    <div className="tree-toolbar">
      <Space size="small" wrap>
        <Tooltip title="放大">
          <Button icon={<ZoomInOutlined />} size="small" onClick={onZoomIn} />
        </Tooltip>
        <Tooltip title="缩小">
          <Button icon={<ZoomOutOutlined />} size="small" onClick={onZoomOut} />
        </Tooltip>
        <Tooltip title="重置视图">
          <Button icon={<AimOutlined />} size="small" onClick={onZoomReset} />
        </Tooltip>

        <Select
          placeholder="展开层级"
          options={genOptions}
          onChange={onExpandToGen}
          size="small"
          style={{ width: 140 }}
          allowClear
        />

        <Tooltip title="展开所有">
          <Button icon={<NodeExpandOutlined />} size="small" onClick={onExpandAll} />
        </Tooltip>
        <Tooltip title="收起所有">
          <Button icon={<NodeCollapseOutlined />} size="small" onClick={onCollapseAll} />
        </Tooltip>

        {hasLockedNodes && (
          <Tooltip title="解锁全部节点">
            <Button
              icon={<UnlockOutlined />}
              size="small"
              onClick={onUnlockAll}
              style={{ color: '#f57c00', borderColor: '#f57c00' }}
            />
          </Tooltip>
        )}

        <Tooltip title={showDetail ? '隐藏个人详情' : '显示个人详情'}>
          <Button
            icon={<IdcardOutlined />}
            size="small"
            type={showDetail ? 'primary' : 'default'}
            onClick={onToggleDetail}
          />
        </Tooltip>

        <Tooltip title={showSpouse ? '隐藏配偶信息' : '显示配偶信息'}>
          <Button
            icon={<TeamOutlined />}
            size="small"
            type={showSpouse ? 'primary' : 'default'}
            onClick={onToggleSpouse}
          />
        </Tooltip>

        <Tooltip title="连线样式">
          <Segmented
            size="small"
            value={linkStyle}
            onChange={(val) => onLinkStyleChange?.(val as LinkStyle)}
            options={[
              { label: '〰 曲线', value: 'curve' },
              { label: '╱ 直线', value: 'straight' },
              { label: '⌐ 折线', value: 'elbow' },
            ]}
          />
        </Tooltip>

        <Search
          placeholder="搜索姓名"
          onSearch={onSearch}
          size="small"
          allowClear
          style={{ width: 180 }}
        />

        <Tooltip title="世代配色">
          <Button
            icon={<BgColorsOutlined />}
            size="small"
            onClick={onOpenColorConfig}
          />
        </Tooltip>

        <Dropdown menu={{ items: exportItems }} placement="bottomRight">
          <Button icon={<DownloadOutlined />} size="small">
            导出
          </Button>
        </Dropdown>

        <Tooltip title="打印装订">
          <Button
            icon={<PrinterOutlined />}
            size="small"
            onClick={onPrint}
          >
            打印
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
};

export default TreeToolbar;
