import React, { useState, useEffect } from 'react';
import { Modal, Input, Tag, Alert, Spin } from 'antd';
import {
  ExclamationCircleOutlined,
  WarningOutlined,
  ManOutlined,
  WomanOutlined,
} from '@ant-design/icons';
import { api } from '../api/bridge';
import type { Person, PersonIndex } from '../types/person';

interface DeleteConfirmDialogProps {
  /** 要删除的成员 */
  person: Person | null;
  /** 是否显示 */
  visible: boolean;
  /** 关闭对话框 */
  onCancel: () => void;
  /** 确认删除 */
  onConfirm: (id: string) => Promise<void>;
  /** 删除进行中 */
  loading?: boolean;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  person,
  visible,
  onCancel,
  onConfirm,
  loading = false,
}) => {
  const [confirmName, setConfirmName] = useState('');
  const [children, setChildren] = useState<PersonIndex[]>([]);
  const [parentName, setParentName] = useState<string | null>(null);
  const [fetchingChildren, setFetchingChildren] = useState(false);

  // 打开对话框时获取子节点信息
  useEffect(() => {
    if (visible && person) {
      setConfirmName('');
      setFetchingChildren(true);
      setParentName(null);

      // 并行获取子女列表和父节点名称
      const fetchChildren = api.tree.getChildren(person.id)
        .then((list) => setChildren(list || []))
        .catch(() => setChildren([]));

      const fetchParent = person.parentId
        ? api.person.get(person.parentId)
            .then((p) => setParentName(p?.name ?? null))
            .catch(() => setParentName(null))
        : Promise.resolve();

      Promise.all([fetchChildren, fetchParent]).finally(() => {
        setFetchingChildren(false);
      });
    } else {
      setChildren([]);
      setConfirmName('');
      setParentName(null);
    }
  }, [visible, person]);

  if (!person) return null;

  const hasChildren = children.length > 0;
  const nameMatches = confirmName.trim() === person.name;

  return (
    <Modal
      title={
        <span style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 16 }}>
          {hasChildren ? (
            <>
              <WarningOutlined style={{ marginRight: 8 }} />
              确认删除（高风险操作）
            </>
          ) : (
            <>
              <ExclamationCircleOutlined style={{ marginRight: 8 }} />
              确认删除
            </>
          )}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      okText={hasChildren ? '确认删除' : '删除'}
      okType="danger"
      okButtonProps={{
        disabled: !nameMatches || loading,
        loading,
      }}
      cancelText="取消"
      onOk={async () => {
        if (nameMatches) {
          await onConfirm(person.id);
        }
      }}
      width={480}
      destroyOnClose
      maskClosable={false}
    >
      {fetchingChildren ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip="正在获取成员信息..." />
        </div>
      ) : (
        <div>
          {/* 成员信息卡片 */}
          <div
            style={{
              background: '#fafafa',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              border: '1px solid #f0f0f0',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {person.name}
              {person.alias && (
                <span style={{ color: '#999', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                  别名：{person.alias}
                </span>
              )}
              {person.courtesy && (
                <span style={{ color: '#888', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  字 {person.courtesy}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Tag
                icon={person.gender === 'male' ? <ManOutlined /> : <WomanOutlined />}
                color={person.gender === 'male' ? 'blue' : 'magenta'}
              >
                {person.gender === 'male' ? '男' : '女'}
              </Tag>
              <Tag color="orange">第{person.generation}世</Tag>
            </div>
          </div>

          {/* 子节点预警 */}
          {hasChildren && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              style={{ marginBottom: 16 }}
              message={
                <span style={{ fontWeight: 600 }}>
                  该成员有 {children.length} 名子女
                </span>
              }
              description={
                <div>
                  <div style={{ margin: '6px 0' }}>
                    {children.map((child, i) => (
                      <Tag key={child.id} color={child.gender === 'male' ? 'blue' : 'magenta'} style={{ marginBottom: 4 }}>
                        {child.name}
                      </Tag>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, color: '#594214' }}>
                    删除后，这些子女将自动挂到
                    {parentName ? (
                      <strong>「{parentName}」</strong>
                    ) : (
                      <strong>根节点</strong>
                    )}
                    名下。
                  </div>
                </div>
              }
            />
          )}

          {/* 不可恢复警告 */}
          <Alert
            type="error"
            showIcon
            message="此操作不可恢复！"
            style={{ marginBottom: 16 }}
          />

          {/* 姓名输入确认 */}
          <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>
            请输入成员姓名 <strong style={{ color: '#ff4d4f' }}>「{person.name}」</strong> 以确认删除：
          </div>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={`请输入「${person.name}」`}
            status={confirmName && !nameMatches ? 'error' : undefined}
            autoFocus
            onPressEnter={async () => {
              if (nameMatches && !loading) {
                await onConfirm(person.id);
              }
            }}
          />
          {confirmName && !nameMatches && (
            <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
              输入的姓名不匹配
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default DeleteConfirmDialog;
