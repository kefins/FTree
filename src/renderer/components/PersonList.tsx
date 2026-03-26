import React, { useState, useEffect, useCallback } from 'react';
import { List, Input, Select, Tag, Empty, Spin } from 'antd';
import { ManOutlined, WomanOutlined } from '@ant-design/icons';
import { api } from '../api/bridge';
import type { PersonIndex, ListQuery } from '../types/person';
import { getColorForGeneration } from '../utils/generationColors';
import { getBirthOrderInfo } from '../utils/birthOrder';

const { Search } = Input;

interface PersonListProps {
  onSelect: (person: PersonIndex) => void;
  selectedId?: string;
  refreshKey?: number;
  /** 扁平化的所有人员索引数据（用于排行计算） */
  rawData?: PersonIndex[];
}

const PersonList: React.FC<PersonListProps> = ({ onSelect, selectedId, refreshKey, rawData = [] }) => {
  const [items, setItems] = useState<PersonIndex[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState<ListQuery>({
    page: 1,
    pageSize: 50,
  });

  const fetchList = useCallback(async (q: ListQuery) => {
    setLoading(true);
    try {
      const res = await api.person.list(q);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList(query);
  }, [query, fetchList, refreshKey]);

  const handleSearch = (value: string) => {
    setQuery((prev) => ({ ...prev, search: value || undefined, page: 1 }));
  };

  const handleGenerationFilter = (value: number | null) => {
    setQuery((prev) => ({ ...prev, generation: value || undefined, page: 1 }));
  };

  const generationOptions = Array.from({ length: 20 }, (_, i) => ({
    label: `第${i + 1}世`,
    value: i + 1,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200 space-y-2">
        <Search
          placeholder="搜索姓名..."
          allowClear
          onSearch={handleSearch}
          size="middle"
        />
        <Select
          placeholder="按世数筛选"
          allowClear
          options={generationOptions}
          onChange={handleGenerationFilter}
          style={{ width: '100%' }}
          size="middle"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <Spin spinning={loading}>
          {items.length === 0 && !loading ? (
            <Empty
              description="暂无数据"
              className="mt-12"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <List
              dataSource={items}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  className={`cursor-pointer px-4 py-2 hover:bg-gray-50 transition-colors ${
                    selectedId === item.id ? 'person-item-selected' : ''
                  }`}
                  onClick={() => onSelect(item)}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      {item.gender === 'male' ? (
                        <ManOutlined className="text-blue-600" />
                      ) : (
                        <WomanOutlined className="text-pink-500" />
                      )}
                      <span className="font-medium">{item.name}</span>
                      {rawData.length > 0 && (() => {
                        const orderInfo = getBirthOrderInfo(item.id, rawData);
                        if (!orderInfo) return null;
                        return (
                          <Tag
                            color={item.gender === 'male' ? 'geekblue' : 'volcano'}
                            style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px', margin: 0 }}
                          >
                            {orderInfo.genderedLabel}
                          </Tag>
                        );
                      })()}
                    </div>
                    <Tag color={getColorForGeneration(item.generation).tag}>
                      第{item.generation}世
                    </Tag>
                  </div>
                </List.Item>
              )}
              pagination={
                total > 50
                  ? {
                      current: query.page,
                      pageSize: query.pageSize,
                      total,
                      size: 'small',
                      showSizeChanger: false,
                      onChange: (page) => setQuery((prev) => ({ ...prev, page })),
                    }
                  : false
              }
            />
          )}
        </Spin>
      </div>
    </div>
  );
};

export default PersonList;
