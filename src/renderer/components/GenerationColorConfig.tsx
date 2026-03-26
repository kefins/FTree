import React, { useState, useEffect } from 'react';
import { Modal, Button, ColorPicker, Space, Tag, Tooltip, message, Table } from 'antd';
import { UndoOutlined, BgColorsOutlined } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import {
  getGenerationColors,
  saveGenerationColors,
  resetGenerationColors,
  getDefaultColors,
  type GenerationColorItem,
} from '../utils/generationColors';

interface GenerationColorConfigProps {
  visible: boolean;
  onClose: () => void;
  onSave?: () => void;
}

const GenerationColorConfig: React.FC<GenerationColorConfigProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const [colors, setColors] = useState<GenerationColorItem[]>([]);

  useEffect(() => {
    if (visible) {
      setColors(getGenerationColors());
    }
  }, [visible]);

  const handleColorChange = (
    index: number,
    field: keyof GenerationColorItem,
    color: Color,
  ) => {
    const hex = color.toHexString();
    setColors((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: hex };
      // 如果改了 border，同步更新 tag 和 text（方便用户快速调整）
      if (field === 'border') {
        next[index].tag = hex;
      }
      return next;
    });
  };

  const handleSave = () => {
    saveGenerationColors(colors);
    message.success('世代配色已保存');
    onSave?.();
    onClose();
  };

  const handleReset = () => {
    const defaults = getDefaultColors();
    setColors(defaults);
    resetGenerationColors();
    message.info('已恢复默认配色');
  };

  const columns = [
    {
      title: '世数',
      dataIndex: 'gen',
      key: 'gen',
      width: 70,
      render: (_: any, __: any, index: number) => (
        <Tag style={{ margin: 0, fontWeight: 600 }}>第{index + 1}世</Tag>
      ),
    },
    {
      title: '预览',
      key: 'preview',
      width: 140,
      render: (_: any, __: any, index: number) => {
        const c = colors[index];
        if (!c) return null;
        return (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 110,
              height: 40,
              borderRadius: 8,
              border: `2px solid ${c.border}`,
              backgroundColor: c.bg,
              color: c.text,
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            第{index + 1}世 · 示例
          </div>
        );
      },
    },
    {
      title: '背景色',
      key: 'bg',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <ColorPicker
          value={colors[index]?.bg}
          size="small"
          onChange={(c) => handleColorChange(index, 'bg', c)}
        />
      ),
    },
    {
      title: '边框色',
      key: 'border',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <ColorPicker
          value={colors[index]?.border}
          size="small"
          onChange={(c) => handleColorChange(index, 'border', c)}
        />
      ),
    },
    {
      title: '文字色',
      key: 'text',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <ColorPicker
          value={colors[index]?.text}
          size="small"
          onChange={(c) => handleColorChange(index, 'text', c)}
        />
      ),
    },
  ];

  const dataSource = colors.map((_, i) => ({ key: i }));

  return (
    <Modal
      title={
        <Space>
          <BgColorsOutlined />
          世代配色设置
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={620}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Tooltip title="恢复为默认配色方案">
            <Button icon={<UndoOutlined />} onClick={handleReset}>
              恢复默认
            </Button>
          </Tooltip>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave}>
              保存配色
            </Button>
          </Space>
        </div>
      }
    >
      <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
        自定义每一世的节点颜色，修改后点击「保存配色」立即生效。
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        scroll={{ y: 400 }}
        rowKey="key"
      />
    </Modal>
  );
};

export default GenerationColorConfig;
