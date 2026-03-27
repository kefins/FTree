import React, { useState, useEffect, useMemo } from 'react';
import {
  Drawer,
  Descriptions,
  Button,
  Space,
  Spin,
  Tag,
  Divider,
  Input,
  Radio,
  InputNumber,
  TreeSelect,
  Form,
  message,
  Modal,
  List,
  Avatar,
} from 'antd';
import {
  EditOutlined,
  TeamOutlined,
  ManOutlined,
  WomanOutlined,
  UserAddOutlined,
  SaveOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../api/bridge';
import type { Person, PersonIndex, TreeNode, CreatePersonDTO, UpdatePersonDTO } from '../types/person';
import { getColorForGeneration } from '../utils/generationColors';
import { getBirthOrderInfo, getNextSortOrder, getGenderedOrderLabel, getUnifiedOrderLabel } from '../utils/birthOrder';

const { TextArea } = Input;

interface TreeSelectOption {
  value: string;
  title: string;
  children?: TreeSelectOption[];
}

function toTreeSelectData(nodes: TreeNode[], excludeId?: string): TreeSelectOption[] {
  return nodes
    .filter((n) => n.id !== excludeId)
    .map((node) => ({
      value: node.id,
      title: `${node.name}（第${node.generation}世）`,
      children: toTreeSelectData(node.children, excludeId),
    }));
}

interface NodeDetailProps {
  personId?: string | null;
  visible: boolean;
  onClose: () => void;
  onEdit?: (person: Person) => void;
  onViewChildren?: (personId: string) => void;
  /** 扁平化的所有人员索引数据（用于排行计算） */
  rawData?: PersonIndex[];
  /** 树结构数据，用于父节点选择 */
  treeData?: TreeNode[];
  /** 保存编辑回调 */
  onSave?: (id: string, data: UpdatePersonDTO) => Promise<Person | null>;
  /** 添加子女回调 */
  onAddChild?: (data: CreatePersonDTO) => Promise<Person | null>;
  /** 删除成员回调 */
  onDelete?: (id: string) => Promise<boolean>;
  /** 数据刷新回调 */
  onRefresh?: () => void;
  /** 刷新数据并确保指定节点展开（添加子女后使用） */
  onRefreshAndExpand?: (nodeId?: string) => Promise<void>;
  /** 外部传入的初始视图模式（右键菜单"编辑"/"添加子女"时使用） */
  initialMode?: 'detail' | 'edit' | 'addChild' | null;
  /** 辈分字映射：世数 → 辈分字 */
  generationChars?: Record<number, string>;
}

type ViewMode = 'detail' | 'edit' | 'addChild' | 'children';

const NodeDetail: React.FC<NodeDetailProps> = ({
  personId,
  visible,
  onClose,
  onEdit,
  onViewChildren,
  rawData = [],
  treeData = [],
  onSave,
  onAddChild,
  onDelete,
  onRefresh,
  onRefreshAndExpand,
  initialMode,
  generationChars = {},
}) => {
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bioParentName, setBioParentName] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('detail');
  const [editForm] = Form.useForm();
  const [childForm] = Form.useForm();
  const [childrenList, setChildrenList] = useState<PersonIndex[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);

  // 父节点名称
  const [parentName, setParentName] = useState<string | null>(null);

  useEffect(() => {
    if (personId && visible) {
      setLoading(true);
      setBioParentName(null);
      setParentName(null);
      setViewMode('detail');
      api.person
        .get(personId)
        .then((p) => {
          setPerson(p);
          // 如果有亲生父亲ID，获取亲生父亲姓名
          if (p.biologicalParentId) {
            api.person
              .get(p.biologicalParentId)
              .then((parent) => setBioParentName(parent?.name ?? null))
              .catch(() => setBioParentName(null));
          }
          // 获取父亲姓名
          if (p.parentId) {
            api.person
              .get(p.parentId)
              .then((parent) => setParentName(parent?.name ?? null))
              .catch(() => setParentName(null));
          }
          // 根据外部传入的 initialMode 自动切换视图
          if (initialMode === 'edit') {
            // 延迟切换到编辑模式，确保 person 数据已设置
            setTimeout(() => {
              editForm.setFieldsValue({
                name: p.name,
                gender: p.gender,
                generation: p.generation,
                parentId: p.parentId || undefined,
                sortOrder: p.sortOrder,
                courtesy: p.courtesy || undefined,
                spouseName: p.spouseName || undefined,
                spouseBirthDate: p.spouseBirthDate || undefined,
                spouseDeathDate: p.spouseDeathDate || undefined,
                spouseBirthPlace: p.spouseBirthPlace || undefined,
                spouseOccupation: p.spouseOccupation || undefined,
                spousePhone: p.spousePhone || undefined,
                spouseAddress: p.spouseAddress || undefined,
                childrenNote: p.childrenNote || undefined,
                birthDate: p.birthDate || undefined,
                deathDate: p.deathDate || undefined,
                birthPlace: p.birthPlace || undefined,
                occupation: p.occupation || undefined,
                phone: p.phone || undefined,
                address: p.address || undefined,
                bio: p.bio || undefined,
              });
              setViewMode('edit');
            }, 0);
          } else if (initialMode === 'addChild') {
            setTimeout(() => {
              const nextOrder = getNextSortOrder(p.id, rawData);
              childForm.resetFields();
              childForm.setFieldsValue({
                gender: 'male',
                generation: p.generation + 1,
                parentId: p.id,
                sortOrder: nextOrder,
              });
              setViewMode('addChild');
            }, 0);
          }
        })
        .catch(() => setPerson(null))
        .finally(() => setLoading(false));
    } else {
      setPerson(null);
      setBioParentName(null);
      setParentName(null);
      setViewMode('detail');
    }
  }, [personId, visible, initialMode]);

  const treeSelectData = useMemo(
    () => toTreeSelectData(treeData, person?.id),
    [treeData, person?.id],
  );

  // 进入编辑模式
  const handleStartEdit = () => {
    if (!person) return;
    editForm.setFieldsValue({
      name: person.name,
      gender: person.gender,
      generation: person.generation,
      parentId: person.parentId || undefined,
      sortOrder: person.sortOrder,
      courtesy: person.courtesy || undefined,
      spouseName: person.spouseName || undefined,
      spouseBirthDate: person.spouseBirthDate || undefined,
      spouseDeathDate: person.spouseDeathDate || undefined,
      spouseBirthPlace: person.spouseBirthPlace || undefined,
      spouseOccupation: person.spouseOccupation || undefined,
      spousePhone: person.spousePhone || undefined,
      spouseAddress: person.spouseAddress || undefined,
      childrenNote: person.childrenNote || undefined,
      birthDate: person.birthDate || undefined,
      deathDate: person.deathDate || undefined,
      birthPlace: person.birthPlace || undefined,
      occupation: person.occupation || undefined,
      phone: person.phone || undefined,
      address: person.address || undefined,
      bio: person.bio || undefined,
    });
    setViewMode('edit');
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!person || !onSave) return;
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      const data: UpdatePersonDTO = {
        name: values.name,
        gender: values.gender,
        generation: values.generation,
        parentId: values.parentId || null,
        sortOrder: values.sortOrder ?? 0,
        courtesy: values.courtesy || undefined,
        spouseName: values.spouseName || undefined,
        spouseBirthDate: values.spouseBirthDate || undefined,
        spouseDeathDate: values.spouseDeathDate || undefined,
        spouseBirthPlace: values.spouseBirthPlace || undefined,
        spouseOccupation: values.spouseOccupation || undefined,
        spousePhone: values.spousePhone || undefined,
        spouseAddress: values.spouseAddress || undefined,
        childrenNote: values.childrenNote || undefined,
        birthDate: values.birthDate || undefined,
        deathDate: values.deathDate || undefined,
        birthPlace: values.birthPlace || undefined,
        occupation: values.occupation || undefined,
        phone: values.phone || undefined,
        address: values.address || undefined,
        bio: values.bio || undefined,
      };
      const updated = await onSave(person.id, data);
      if (updated) {
        setPerson(updated);
        setViewMode('detail');
        onRefresh?.();
      }
    } catch {
      // form validation failed
    } finally {
      setSaving(false);
    }
  };

  // 进入添加子女模式
  const handleStartAddChild = () => {
    if (!person) return;
    const nextOrder = getNextSortOrder(person.id, rawData);
    childForm.resetFields();
    childForm.setFieldsValue({
      gender: 'male',
      generation: person.generation + 1,
      parentId: person.id,
      sortOrder: nextOrder,
    });
    setViewMode('addChild');
  };

  // 保存新子女
  const handleSaveChild = async () => {
    if (!person || !onAddChild) return;
    try {
      const values = await childForm.validateFields();
      setSaving(true);
      const data: CreatePersonDTO = {
        name: values.name,
        gender: values.gender,
        generation: values.generation,
        parentId: person.id,
        sortOrder: values.sortOrder ?? 0,
        biologicalParentId: null,
        spouseName: values.spouseName || undefined,
        spouseBirthDate: values.spouseBirthDate || undefined,
        spouseDeathDate: values.spouseDeathDate || undefined,
        spouseBirthPlace: values.spouseBirthPlace || undefined,
        spouseOccupation: values.spouseOccupation || undefined,
        spousePhone: values.spousePhone || undefined,
        spouseAddress: values.spouseAddress || undefined,
        childrenNote: values.childrenNote || undefined,
        courtesy: values.courtesy || undefined,
        birthDate: values.birthDate || undefined,
        deathDate: values.deathDate || undefined,
        birthPlace: values.birthPlace || undefined,
        occupation: values.occupation || undefined,
        phone: values.phone || undefined,
        address: values.address || undefined,
        bio: values.bio || undefined,
      };
      const newPerson = await onAddChild(data);
      if (newPerson) {
        // 使用 refreshAndExpand 保持父节点展开状态，不重置整棵树
        if (onRefreshAndExpand) {
          await onRefreshAndExpand(person.id);
        } else {
          onRefresh?.();
        }
        message.success(`已添加子女「${newPerson.name}」`);
        // 重置表单，保持在添加子女模式以便连续添加
        const nextOrder = getNextSortOrder(person.id, rawData) + 1;
        childForm.resetFields();
        childForm.setFieldsValue({
          generation: person.generation + 1,
          gender: 'male',
          sortOrder: nextOrder,
        });
      }
    } catch {
      // form validation failed
    } finally {
      setSaving(false);
    }
  };

  // 删除当前成员
  const handleDelete = () => {
    if (!person || !onDelete) return;
    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除「${person.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        const success = await onDelete(person.id);
        if (success) {
          onClose();
          onRefresh?.();
        }
      },
    });
  };

  // 查看子女列表
  const handleViewChildren = async () => {
    if (!person) return;
    setChildrenLoading(true);
    try {
      const children = await api.tree.getChildren(person.id);
      setChildrenList(children || []);
      setViewMode('children');
    } catch {
      message.error('获取子女信息失败');
    } finally {
      setChildrenLoading(false);
    }
  };

  // 点击子女项，跳转到该子女的详情
  const handleChildClick = (childId: string) => {
    // 重新加载该子女的详情（复用组件自身逻辑）
    setViewMode('detail');
    setChildrenList([]);
    // 通过 onViewChildren 回调通知父组件切换到该子女
    onViewChildren?.(childId);
  };

  // 渲染标题
  const getDrawerTitle = () => {
    switch (viewMode) {
      case 'edit':
        return '编辑成员';
      case 'addChild':
        return `添加子女 — ${person?.name}`;
      case 'children':
        return `子女信息 — ${person?.name}`;
      default:
        return '成员详情';
    }
  };

  // 渲染顶部按钮
  const renderExtra = () => {
    if (viewMode === 'edit') {
      return (
        <Space>
          <Button size="small" icon={<CloseOutlined />} onClick={() => setViewMode('detail')}>
            取消
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSaveEdit}
            loading={saving}
          >
            保存
          </Button>
        </Space>
      );
    }
    if (viewMode === 'addChild') {
      return (
        <Space>
          <Button size="small" icon={<CloseOutlined />} onClick={() => setViewMode('detail')}>
            取消
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSaveChild}
            loading={saving}
          >
            保存
          </Button>
        </Space>
      );
    }
    if (viewMode === 'children') {
      return (
        <Button size="small" icon={<CloseOutlined />} onClick={() => setViewMode('detail')}>
          返回
        </Button>
      );
    }
    // detail mode
    return person ? (
      <Space>
        {onSave && (
          <Button
            type="primary"
            icon={<EditOutlined />}
            size="small"
            onClick={handleStartEdit}
          >
            编辑
          </Button>
        )}
      </Space>
    ) : null;
  };

  // 渲染详情视图
  const renderDetailView = () => {
    if (!person) return null;
    return (
      <div>
        <div className="text-center mb-4">
          <div className="text-2xl font-serif font-bold mb-1">{person.name}</div>
          {person.courtesy && (
            <div className="text-gray-500">字 {person.courtesy}</div>
          )}
          <div className="mt-2">
            <Tag
              icon={person.gender === 'male' ? <ManOutlined /> : <WomanOutlined />}
              color={person.gender === 'male' ? 'blue' : 'magenta'}
            >
              {person.gender === 'male' ? '男' : '女'}
            </Tag>
            <Tag color={getColorForGeneration(person.generation).tag}>第{person.generation}世</Tag>
            {generationChars[person.generation] && (
              <Tag color="gold" style={{ fontWeight: 600, fontSize: 14, fontFamily: 'serif' }}>
                辈分字「{generationChars[person.generation]}」
              </Tag>
            )}
            {(() => {
              const isAdopted = !!person.biologicalParentId && person.biologicalParentId !== person.parentId;
              if (isAdopted) {
                // 被过继的人：分别显示过继后排行和亲生排行
                const adoptiveOrder = personId ? getBirthOrderInfo(personId, rawData, 'adoptive') : null;
                const biologicalOrder = personId ? getBirthOrderInfo(personId, rawData, 'biological') : null;
                return (
                  <>
                    {adoptiveOrder && (
                      <>
                        <Tag color="cyan">{adoptiveOrder.unifiedLabel}</Tag>
                        <Tag color={person.gender === 'male' ? 'geekblue' : 'volcano'}>
                          {adoptiveOrder.genderedLabel}
                        </Tag>
                      </>
                    )}
                    {biologicalOrder && (
                      <Tag color="orange" style={{ fontSize: 11 }}>
                        亲生{biologicalOrder.unifiedLabel}
                      </Tag>
                    )}
                  </>
                );
              }
              // 未过继的人：正常显示排行
              const orderInfo = personId ? getBirthOrderInfo(personId, rawData) : null;
              if (!orderInfo) return null;
              return (
                <>
                  <Tag color="cyan">{orderInfo.unifiedLabel}</Tag>
                  <Tag color={person.gender === 'male' ? 'geekblue' : 'volcano'}>
                    {orderInfo.genderedLabel}
                  </Tag>
                </>
              );
            })()}
          </div>
        </div>

        <Divider />

        {/* 过继信息（如有） */}
        {person.biologicalParentId && bioParentName && (
          <div style={{ marginBottom: 12, padding: '6px 12px', background: '#fff7e6', borderRadius: 6, fontSize: 13 }}>
            <Tag color="orange">过继</Tag>
            亲生父亲：{bioParentName}
            {parentName && <span style={{ marginLeft: 12 }}>养父：{parentName}</span>}
          </div>
        )}
        {!person.biologicalParentId && parentName && (
          <div style={{ marginBottom: 12, padding: '6px 12px', background: '#f0f5ff', borderRadius: 6, fontSize: 13, color: '#1677ff' }}>
            父亲：{parentName}
          </div>
        )}

        {/* 两栏布局：当事人信息 + 配偶信息 */}
        <div style={{ display: 'flex', gap: 12 }}>
          {/* 左栏：当事人信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#1677ff', marginBottom: 8,
              borderBottom: '2px solid #1677ff', paddingBottom: 4,
            }}>
              本人信息
            </div>
            <Descriptions column={1} size="small" labelStyle={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              {person.birthDate && (
                <Descriptions.Item label="出生日期">{person.birthDate}</Descriptions.Item>
              )}
              {person.deathDate && (
                <Descriptions.Item label="逝世日期">{person.deathDate}</Descriptions.Item>
              )}
              {person.birthPlace && (
                <Descriptions.Item label="籍贯">{person.birthPlace}</Descriptions.Item>
              )}
              {person.occupation && (
                <Descriptions.Item label="职业">{person.occupation}</Descriptions.Item>
              )}
              {person.phone && (
                <Descriptions.Item label="联系电话">{person.phone}</Descriptions.Item>
              )}
              {person.address && (
                <Descriptions.Item label="现住址">{person.address}</Descriptions.Item>
              )}
            </Descriptions>
            {!person.birthDate && !person.deathDate && !person.birthPlace && !person.occupation && !person.phone && !person.address && (
              <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>暂无详细信息</div>
            )}
          </div>

          {/* 分隔线 */}
          <div style={{ width: 1, background: '#f0f0f0', flexShrink: 0 }} />

          {/* 右栏：配偶信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#722ed1', marginBottom: 8,
              borderBottom: '2px solid #722ed1', paddingBottom: 4,
            }}>
              配偶信息
            </div>
            {person.spouseName ? (
              <Descriptions column={1} size="small" labelStyle={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                <Descriptions.Item label="姓名">{person.spouseName}</Descriptions.Item>
                {person.spouseBirthDate && (
                  <Descriptions.Item label="出生日期">{person.spouseBirthDate}</Descriptions.Item>
                )}
                {person.spouseDeathDate && (
                  <Descriptions.Item label="逝世日期">{person.spouseDeathDate}</Descriptions.Item>
                )}
                {person.spouseBirthPlace && (
                  <Descriptions.Item label="籍贯">{person.spouseBirthPlace}</Descriptions.Item>
                )}
                {person.spouseOccupation && (
                  <Descriptions.Item label="职业">{person.spouseOccupation}</Descriptions.Item>
                )}
                {person.spousePhone && (
                  <Descriptions.Item label="联系电话">{person.spousePhone}</Descriptions.Item>
                )}
                {person.spouseAddress && (
                  <Descriptions.Item label="现住址">{person.spouseAddress}</Descriptions.Item>
                )}
              </Descriptions>
            ) : (
              <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>暂无配偶信息</div>
            )}
          </div>
        </div>

        {/* 女性成员子女备注 */}
        {person.gender === 'female' && (
          <>
            <Divider />
            <div>
              <div style={{
                fontSize: 13, fontWeight: 600, color: '#eb2f96', marginBottom: 8,
                borderBottom: '2px solid #eb2f96', paddingBottom: 4,
              }}>
                子女情况
              </div>
              {person.childrenNote ? (
                <div className="text-gray-600 text-sm whitespace-pre-wrap">{person.childrenNote}</div>
              ) : (
                <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>暂未标注子女情况</div>
              )}
            </div>
          </>
        )}

        {person.bio && (
          <>
            <Divider />
            <div>
              <div className="font-semibold mb-2">个人简介</div>
              <div className="text-gray-600 text-sm whitespace-pre-wrap">
                {person.bio}
              </div>
            </div>
          </>
        )}

        <Divider />

        <div className="flex justify-center gap-2">
          {onAddChild && (
            <Button
              type="primary"
              ghost
              icon={<UserAddOutlined />}
              onClick={handleStartAddChild}
            >
              添加子女
            </Button>
          )}
          {onViewChildren && (
            <Button
              icon={<TeamOutlined />}
              onClick={handleViewChildren}
              loading={childrenLoading}
            >
              子女信息
            </Button>
          )}
          {onDelete && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleDelete}
            >
              删除
            </Button>
          )}
        </div>
      </div>
    );
  };

  // 渲染编辑表单
  const renderEditForm = () => {
    if (!person) return null;
    return (
      <Form form={editForm} layout="vertical" size="small">
        <Form.Item
          label="姓名"
          name="name"
          rules={[{ required: true, message: '请输入姓名' }]}
        >
          <Input placeholder="请输入姓名" maxLength={50} />
        </Form.Item>

        <Form.Item
          label="性别"
          name="gender"
          rules={[{ required: true, message: '请选择性别' }]}
        >
          <Radio.Group>
            <Radio value="male">男</Radio>
            <Radio value="female">女</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item label="父亲" name="parentId">
          <TreeSelect
            treeData={treeSelectData}
            placeholder="选择父亲（留空表示根节点）"
            allowClear
            showSearch
            treeDefaultExpandAll
            filterTreeNode={(input, node) =>
              (node?.title as string)?.toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          label="世数"
          name="generation"
          rules={[{ required: true, message: '请输入世数' }]}
        >
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="同辈排行" name="sortOrder" tooltip="数字越小排越靠前（从左到右）">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="排行序号" />
        </Form.Item>

        {/* 两栏布局：本人信息 + 配偶信息 */}
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左栏：本人信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Divider orientation="left" plain style={{ fontSize: 13 }}>
              本人信息
            </Divider>

            <Form.Item label="字/号" name="courtesy">
              <Input placeholder="字或号" maxLength={50} />
            </Form.Item>

            <Form.Item label="出生日期" name="birthDate">
              <Input placeholder="如：1950-01-01 或 庚寅年" />
            </Form.Item>

            <Form.Item label="逝世日期" name="deathDate">
              <Input placeholder="如：2020-12-31 或 留空" />
            </Form.Item>

            <Form.Item label="籍贯" name="birthPlace">
              <Input placeholder="籍贯" maxLength={200} />
            </Form.Item>

            <Form.Item label="职业" name="occupation">
              <Input placeholder="职业" maxLength={100} />
            </Form.Item>

            <Form.Item label="联系电话" name="phone">
              <Input placeholder="联系电话" maxLength={20} />
            </Form.Item>

            <Form.Item label="现住址" name="address">
              <Input placeholder="现住址" maxLength={300} />
            </Form.Item>
          </div>

          {/* 右栏：配偶信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Divider orientation="left" plain style={{ fontSize: 13, color: '#722ed1' }}>
              配偶信息
            </Divider>

            <Form.Item label="配偶姓名" name="spouseName">
              <Input placeholder="配偶姓名" maxLength={50} />
            </Form.Item>

            <Form.Item label="出生日期" name="spouseBirthDate">
              <Input placeholder="配偶出生日期" />
            </Form.Item>

            <Form.Item label="逝世日期" name="spouseDeathDate">
              <Input placeholder="配偶逝世日期" />
            </Form.Item>

            <Form.Item label="籍贯" name="spouseBirthPlace">
              <Input placeholder="配偶籍贯" maxLength={200} />
            </Form.Item>

            <Form.Item label="职业" name="spouseOccupation">
              <Input placeholder="配偶职业" maxLength={100} />
            </Form.Item>

            <Form.Item label="联系电话" name="spousePhone">
              <Input placeholder="配偶电话" maxLength={20} />
            </Form.Item>

            <Form.Item label="现住址" name="spouseAddress">
              <Input placeholder="配偶现住址" maxLength={300} />
            </Form.Item>
          </div>
        </div>

        {/* 女性成员子女备注 */}
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.gender !== cur.gender}>
          {({ getFieldValue }) =>
            getFieldValue('gender') === 'female' ? (
              <Form.Item
                label={<span style={{ color: '#eb2f96', fontWeight: 600 }}>子女情况</span>}
                name="childrenNote"
                tooltip="女性成员按传统家谱不单独录入子女，此处简要标注以供参考"
              >
                <TextArea rows={2} placeholder="如：育有二子一女，长子xxx、次子xxx、长女xxx" maxLength={500} />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item label="个人简介" name="bio">
          <TextArea rows={3} placeholder="个人简介" maxLength={1000} />
        </Form.Item>
      </Form>
    );
  };

  // 渲染添加子女表单
  const renderAddChildForm = () => {
    if (!person) return null;
    return (
      <Form form={childForm} layout="vertical" size="small">
        <div
          style={{
            marginBottom: 16,
            padding: '8px 12px',
            background: '#f0f5ff',
            borderRadius: 6,
            fontSize: 13,
            color: '#1677ff',
          }}
        >
          父亲：{person.name}（第{person.generation}世）
          {generationChars[person.generation + 1] && (
            <span style={{ marginLeft: 12, color: '#c49a2a', fontWeight: 600 }}>
              子女辈分字：「{generationChars[person.generation + 1]}」
            </span>
          )}
        </div>

        <Form.Item
          label="姓名"
          name="name"
          rules={[{ required: true, message: '请输入子女姓名' }]}
        >
          <Input placeholder="请输入子女姓名" maxLength={50} />
        </Form.Item>

        <Form.Item
          label="性别"
          name="gender"
          rules={[{ required: true, message: '请选择性别' }]}
        >
          <Radio.Group>
            <Radio value="male">男</Radio>
            <Radio value="female">女</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item label="世数" name="generation">
          <InputNumber min={1} max={100} style={{ width: '100%' }} disabled />
        </Form.Item>

        <Form.Item label="同辈排行" name="sortOrder" tooltip="数字越小排越靠前（从左到右）">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="排行序号（自动分配）" />
        </Form.Item>

        <Form.Item name="parentId" hidden>
          <Input />
        </Form.Item>

        {/* 两栏布局：本人信息 + 配偶信息 */}
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左栏：本人信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Divider orientation="left" plain style={{ fontSize: 13 }}>
              本人信息（可选）
            </Divider>

            <Form.Item label="字/号" name="courtesy">
              <Input placeholder="字或号" maxLength={50} />
            </Form.Item>

            <Form.Item label="出生日期" name="birthDate">
              <Input placeholder="如：1950-01-01 或 庚寅年" />
            </Form.Item>

            <Form.Item label="逝世日期" name="deathDate">
              <Input placeholder="如：2020-12-31 或 留空" />
            </Form.Item>

            <Form.Item label="籍贯" name="birthPlace">
              <Input placeholder="籍贯" maxLength={200} />
            </Form.Item>

            <Form.Item label="职业" name="occupation">
              <Input placeholder="职业" maxLength={100} />
            </Form.Item>

            <Form.Item label="联系电话" name="phone">
              <Input placeholder="联系电话" maxLength={20} />
            </Form.Item>

            <Form.Item label="现住址" name="address">
              <Input placeholder="现住址" maxLength={300} />
            </Form.Item>
          </div>

          {/* 右栏：配偶信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Divider orientation="left" plain style={{ fontSize: 13, color: '#722ed1' }}>
              配偶信息（可选）
            </Divider>

            <Form.Item label="配偶姓名" name="spouseName">
              <Input placeholder="配偶姓名" maxLength={50} />
            </Form.Item>

            <Form.Item label="出生日期" name="spouseBirthDate">
              <Input placeholder="配偶出生日期" />
            </Form.Item>

            <Form.Item label="逝世日期" name="spouseDeathDate">
              <Input placeholder="配偶逝世日期" />
            </Form.Item>

            <Form.Item label="籍贯" name="spouseBirthPlace">
              <Input placeholder="配偶籍贯" maxLength={200} />
            </Form.Item>

            <Form.Item label="职业" name="spouseOccupation">
              <Input placeholder="配偶职业" maxLength={100} />
            </Form.Item>

            <Form.Item label="联系电话" name="spousePhone">
              <Input placeholder="配偶电话" maxLength={20} />
            </Form.Item>

            <Form.Item label="现住址" name="spouseAddress">
              <Input placeholder="配偶现住址" maxLength={300} />
            </Form.Item>
          </div>
        </div>

        {/* 女性子女子女备注 */}
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.gender !== cur.gender}>
          {({ getFieldValue }) =>
            getFieldValue('gender') === 'female' ? (
              <Form.Item
                label={<span style={{ color: '#eb2f96', fontWeight: 600 }}>子女情况</span>}
                name="childrenNote"
                tooltip="女性成员按传统家谱不单独录入子女，此处简要标注以供参考"
              >
                <TextArea rows={2} placeholder="如：育有二子一女，长子xxx、次子xxx、长女xxx" maxLength={500} />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item label="个人简介" name="bio">
          <TextArea rows={3} placeholder="个人简介" maxLength={1000} />
        </Form.Item>
      </Form>
    );
  };

  // 渲染子女列表视图
  const renderChildrenView = () => {
    if (!person) return null;
    if (childrenList.length === 0) {
      return (
        <div className="text-center text-gray-400 mt-12">
          <TeamOutlined style={{ fontSize: 40, marginBottom: 12 }} />
          <div>暂无子女信息</div>
          {onAddChild && (
            <Button
              type="primary"
              ghost
              icon={<UserAddOutlined />}
              style={{ marginTop: 16 }}
              onClick={handleStartAddChild}
            >
              添加子女
            </Button>
          )}
        </div>
      );
    }
    return (
      <div>
        <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>
          共 {childrenList.length} 名子女
        </div>
        <List
          dataSource={childrenList}
          renderItem={(child) => {
            const orderInfo = getBirthOrderInfo(child.id, rawData);
            return (
              <List.Item
                style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 8 }}
                className="hover-highlight-item"
                onClick={() => handleChildClick(child.id)}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      style={{
                        backgroundColor: child.gender === 'male' ? '#1677ff' : '#eb2f96',
                      }}
                      icon={child.gender === 'male' ? <ManOutlined /> : <WomanOutlined />}
                    />
                  }
                  title={
                    <span>
                      {child.name}
                      {child.spouseName && (
                        <span style={{ color: '#999', fontWeight: 'normal', fontSize: 12, marginLeft: 8 }}>
                          配偶：{child.spouseName}
                        </span>
                      )}
                    </span>
                  }
                  description={
                    <Space size={4}>
                      <Tag
                        color={child.gender === 'male' ? 'blue' : 'magenta'}
                        style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}
                      >
                        {child.gender === 'male' ? '男' : '女'}
                      </Tag>
                      <Tag
                        color={getColorForGeneration(child.generation).tag}
                        style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}
                      >
                        第{child.generation}世
                      </Tag>
                      {orderInfo && (
                        <Tag
                          color="cyan"
                          style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}
                        >
                          {orderInfo.unifiedLabel}
                        </Tag>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
        {onAddChild && (
          <div className="text-center" style={{ marginTop: 16 }}>
            <Button
              type="primary"
              ghost
              icon={<UserAddOutlined />}
              onClick={handleStartAddChild}
            >
              继续添加子女
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Drawer
      title={getDrawerTitle()}
      open={visible}
      onClose={onClose}
      width={640}
      extra={renderExtra()}
      destroyOnClose
    >
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <Spin />
        </div>
      ) : person ? (
        <>
          {viewMode === 'detail' && renderDetailView()}
          {viewMode === 'edit' && renderEditForm()}
          {viewMode === 'addChild' && renderAddChildForm()}
          {viewMode === 'children' && renderChildrenView()}
        </>
      ) : (
        <div className="text-center text-gray-400 mt-12">未找到成员信息</div>
      )}
    </Drawer>
  );
};

export default NodeDetail;
