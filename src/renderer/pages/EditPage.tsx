import React, { useState, useCallback, useEffect } from 'react';
import { Button, Modal, Empty, message } from 'antd';
import { PlusOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import PersonList from '../components/PersonList';
import PersonForm from '../components/PersonForm';
import { usePersonCRUD } from '../hooks/usePersonCRUD';
import { useTreeData } from '../hooks/useTreeData';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/bridge';
import type { Person, PersonIndex, CreatePersonDTO, UpdatePersonDTO } from '../types/person';

const EditPage: React.FC = () => {
  const { permissions } = useAuth();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { treeData, rawData, refresh: refreshTree } = useTreeData();

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refreshTree();
  }, [refreshTree]);

  const { create, update, remove, loading } = usePersonCRUD(handleRefresh);

  const handleSelect = useCallback(async (person: PersonIndex) => {
    setSelectedId(person.id);
    setIsAdding(false);
    try {
      const full = await api.person.get(person.id);
      setSelectedPerson(full);
    } catch {
      setSelectedPerson(null);
    }
  }, []);

  const handleAdd = () => {
    setSelectedId(undefined);
    setSelectedPerson(null);
    setIsAdding(true);
  };

  const handleSubmit = async (data: CreatePersonDTO | UpdatePersonDTO) => {
    if (isAdding) {
      const result = await create(data as CreatePersonDTO);
      if (result) {
        setIsAdding(false);
        setSelectedId(result.id);
        setSelectedPerson(result);
      }
    } else if (selectedId) {
      const result = await update(selectedId, data as UpdatePersonDTO);
      if (result) {
        setSelectedPerson(result);
      }
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    if (!selectedId) {
      setSelectedPerson(null);
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除「${selectedPerson?.name || ''}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        const success = await remove(selectedId);
        if (success) {
          setSelectedId(undefined);
          setSelectedPerson(null);
        }
      },
    });
  };

  return (
    <div className="flex h-full">
      {/* 左侧列表 */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="flex-1 overflow-hidden">
          <PersonList
            onSelect={handleSelect}
            selectedId={selectedId}
            refreshKey={refreshKey}
            rawData={rawData}
          />
        </div>
        <div className="p-3 border-t border-gray-200">
          {permissions.canEdit && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={handleAdd}
          >
            新增成员
          </Button>
          )}
        </div>
      </div>

      {/* 右侧表单 */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {isAdding || selectedPerson ? (
          <div className="max-w-2xl mx-auto">
            <PersonForm
              initialValues={isAdding ? undefined : selectedPerson || undefined}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              treeData={treeData}
              rawData={rawData}
              loading={loading}
            />
            {!isAdding && selectedId && permissions.canDelete && (
              <div className="px-4 pb-4">
                <Button danger onClick={handleDelete}>
                  删除此成员
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Empty
              description="选择左侧成员进行编辑，或点击「新增成员」添加"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default EditPage;
