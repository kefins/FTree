import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space, Tag, Tooltip, message, Table, InputNumber, Divider } from 'antd';
import { UndoOutlined, EditOutlined, BookOutlined } from '@ant-design/icons';
import type { GenerationCharConfig as GenCharConfig } from '../types/person';
import {
  loadGenerationChars,
  saveGenerationChars,
  parsePoemToCharacters,
} from '../utils/generationChars';

const { TextArea } = Input;

interface GenerationCharConfigProps {
  visible: boolean;
  onClose: () => void;
  onSave?: () => void;
  /** 当前族谱中最大世数（用于决定显示多少行） */
  maxGeneration?: number;
}

const GenerationCharConfig: React.FC<GenerationCharConfigProps> = ({
  visible,
  onClose,
  onSave,
  maxGeneration = 20,
}) => {
  const [poem, setPoem] = useState('');
  const [characters, setCharacters] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startGen, setStartGen] = useState(1);
  /** 显示行数：至少显示到 maxGeneration，且不少于20 */
  const rowCount = Math.max(maxGeneration, 20);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      loadGenerationChars()
        .then((data) => {
          setPoem(data.poem || '');
          setCharacters(data.characters || {});
        })
        .catch(() => {
          message.error('加载辈分字配置失败');
        })
        .finally(() => setLoading(false));
    }
  }, [visible]);

  const handleCharChange = (gen: number, value: string) => {
    setCharacters((prev) => {
      const next = { ...prev };
      if (value) {
        // 只取第一个字
        next[gen] = value.slice(0, 1);
      } else {
        delete next[gen];
      }
      return next;
    });
  };

  const handleParsePoemAuto = () => {
    if (!poem.trim()) {
      message.warning('请先输入字辈诗');
      return;
    }
    const parsed = parsePoemToCharacters(poem, startGen);
    // 合并：诗中解析的覆盖现有的对应位置，保留其余
    setCharacters((prev) => ({
      ...prev,
      ...parsed,
    }));
    message.success(`已从字辈诗解析 ${Object.keys(parsed).length} 个辈分字`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: GenCharConfig = {
        poem: poem.trim() || undefined,
        characters,
      };
      await saveGenerationChars(config);
      message.success('辈分字配置已保存');
      onSave?.();
      onClose();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setPoem('');
    setCharacters({});
    message.info('已清空所有辈分字');
  };

  const columns = [
    {
      title: '世数',
      key: 'gen',
      width: 70,
      render: (_: any, __: any, index: number) => (
        <Tag style={{ margin: 0, fontWeight: 600 }}>第{index + 1}世</Tag>
      ),
    },
    {
      title: '辈分字',
      key: 'char',
      width: 100,
      render: (_: any, __: any, index: number) => {
        const gen = index + 1;
        return (
          <Input
            value={characters[gen] || ''}
            onChange={(e) => handleCharChange(gen, e.target.value)}
            placeholder="—"
            maxLength={1}
            style={{ width: 60, textAlign: 'center', fontWeight: 600, fontSize: 16 }}
          />
        );
      },
    },
    {
      title: '预览',
      key: 'preview',
      width: 160,
      render: (_: any, __: any, index: number) => {
        const gen = index + 1;
        const char = characters[gen];
        if (!char) {
          return <span style={{ color: '#ccc', fontSize: 12 }}>未设置</span>;
        }
        return (
          <span style={{ fontSize: 14 }}>
            第{gen}世 · <strong style={{ color: '#c49a2a', fontSize: 16 }}>{char}</strong>
          </span>
        );
      },
    },
  ];

  const dataSource = Array.from({ length: rowCount }, (_, i) => ({ key: i }));

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          字辈管理
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={660}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Tooltip title="清空所有辈分字配置">
            <Button icon={<UndoOutlined />} onClick={handleReset}>
              全部清空
            </Button>
          </Tooltip>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave} loading={saving}>
              保存
            </Button>
          </Space>
        </div>
      }
    >
      {/* 字辈诗输入区 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
          <BookOutlined style={{ marginRight: 6 }} />
          字辈诗 / 派语（可选）
        </div>
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          输入完整的字辈诗后，可一键解析分配到各世。每个字对应一世的辈分字。
        </div>
        <TextArea
          value={poem}
          onChange={(e) => setPoem(e.target.value)}
          placeholder="例如：国正天心顺 官清民自安 妻贤夫祸少 子孝父心宽"
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={{ fontFamily: 'serif', fontSize: 15, letterSpacing: 2 }}
        />
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#666' }}>从第</span>
          <InputNumber
            value={startGen}
            onChange={(v) => setStartGen(v || 1)}
            min={1}
            max={100}
            size="small"
            style={{ width: 60 }}
          />
          <span style={{ fontSize: 12, color: '#666' }}>世开始</span>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<EditOutlined />}
            onClick={handleParsePoemAuto}
          >
            解析分配
          </Button>
        </div>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* 逐世辈分字表格 */}
      <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
        逐世辈分字配置：点击输入框直接设置每一世的辈分字。
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        scroll={{ y: 300 }}
        rowKey="key"
        loading={loading}
      />
    </Modal>
  );
};

export default GenerationCharConfig;
