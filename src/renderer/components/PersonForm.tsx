import React, { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Radio,
  InputNumber,
  TreeSelect,
  Collapse,
  DatePicker,
  Button,
  Space,
  Switch,
  Alert,
  Tag,
} from 'antd';
import type { TreeNode, CreatePersonDTO, UpdatePersonDTO, Person, PersonIndex } from '../types/person';
import { getGenderedOrderLabel, getUnifiedOrderLabel, getNextSortOrder } from '../utils/birthOrder';

const { TextArea } = Input;

interface PersonFormProps {
  initialValues?: Partial<Person>;
  onSubmit: (data: CreatePersonDTO | UpdatePersonDTO) => void;
  onCancel: () => void;
  treeData: TreeNode[];
  /** 扁平化的所有人员索引数据（用于排行计算） */
  rawData?: PersonIndex[];
  loading?: boolean;
}

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

/** 在扁平化的树中查找指定节点的 generation */
function findGeneration(nodes: TreeNode[], id: string): number | null {
  for (const node of nodes) {
    if (node.id === id) return node.generation;
    const found = findGeneration(node.children, id);
    if (found !== null) return found;
  }
  return null;
}

const PersonForm: React.FC<PersonFormProps> = ({
  initialValues,
  onSubmit,
  onCancel,
  treeData,
  rawData = [],
  loading,
}) => {
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;
  const [isAdopted, setIsAdopted] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | undefined>(
    initialValues?.parentId || undefined,
  );
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>(
    initialValues?.gender || 'male',
  );

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue({
        ...initialValues,
        birthDate: initialValues.birthDate || undefined,
        deathDate: initialValues.deathDate || undefined,
      });
      setIsAdopted(!!initialValues.biologicalParentId);
      setSelectedParentId(initialValues.parentId || undefined);
      setSelectedGender(initialValues.gender || 'male');
    } else {
      form.resetFields();
      setIsAdopted(false);
      setSelectedParentId(undefined);
      setSelectedGender('male');
    }
  }, [initialValues, form]);

  const treeSelectData = useMemo(
    () => toTreeSelectData(treeData, initialValues?.id),
    [treeData, initialValues?.id],
  );

  /** 计算当前排行预览信息 */
  const orderPreview = useMemo(() => {
    if (!selectedParentId || rawData.length === 0) return null;

    // 找到同一亲生父亲的所有子女（包括被过继出去的），排除正在编辑的自己
    const siblings = rawData
      .filter((p) => {
        if (p.id === initialValues?.id) return false;
        // 直系子女
        if (p.parentId === selectedParentId) return true;
        // 亲生但被过继出去的子女
        if (p.biologicalParentId === selectedParentId && p.parentId !== selectedParentId) return true;
        return false;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const totalCount = siblings.length + 1; // 包括自己
    const sameGenderCount = siblings.filter((p) => p.gender === selectedGender).length + 1;

    // 当前排序值
    const currentSortOrder = form.getFieldValue('sortOrder') || 0;

    // 计算统一排行位置
    let unifiedPos = totalCount; // 默认排最后
    if (currentSortOrder > 0) {
      unifiedPos = 1;
      for (const s of siblings) {
        if (s.sortOrder < currentSortOrder) unifiedPos++;
      }
    }

    // 计算分性别排行位置
    const sameGenderSiblings = siblings.filter((p) => p.gender === selectedGender);
    let genderedPos = sameGenderCount;
    if (currentSortOrder > 0) {
      genderedPos = 1;
      for (const s of sameGenderSiblings) {
        if (s.sortOrder < currentSortOrder) genderedPos++;
      }
    }

    return {
      unifiedLabel: getUnifiedOrderLabel(unifiedPos),
      genderedLabel: getGenderedOrderLabel(genderedPos, selectedGender),
      siblings,
      totalCount,
      sameGenderCount,
    };
  }, [selectedParentId, selectedGender, rawData, initialValues?.id, form]);

  /** 选择父亲后自动更新世数为 父世数 + 1，并自动推荐 sortOrder */
  const handleParentChange = (parentId: string | undefined) => {
    setSelectedParentId(parentId || undefined);
    if (!parentId) return;
    const parentGen = findGeneration(treeData, parentId);
    if (parentGen !== null) {
      form.setFieldsValue({ generation: parentGen + 1 });
    }
    // 自动推荐排在最后
    if (!isEdit && rawData.length > 0) {
      const nextOrder = getNextSortOrder(parentId, rawData);
      form.setFieldsValue({ sortOrder: nextOrder });
    }
  };

  const handleFinish = (values: any) => {
    const data: any = {
      name: values.name,
      gender: values.gender,
      generation: values.generation,
      parentId: values.parentId || null,
      biologicalParentId: isAdopted ? (values.biologicalParentId || null) : null,
      sortOrder: values.sortOrder ?? 0,
      spouseName: values.spouseName || undefined,
      spouseBirthDate: values.spouseBirthDate || undefined,
      spouseDeathDate: values.spouseDeathDate || undefined,
      spouseBirthPlace: values.spouseBirthPlace || undefined,
      spouseOccupation: values.spouseOccupation || undefined,
      spousePhone: values.spousePhone || undefined,
      spouseAddress: values.spouseAddress || undefined,
      childrenNote: values.childrenNote || undefined,
      alias: values.alias || undefined,
      courtesy: values.courtesy || undefined,
      birthDate: values.birthDate || undefined,
      deathDate: values.deathDate || undefined,
      birthPlace: values.birthPlace || undefined,
      occupation: values.occupation || undefined,
      phone: values.phone || undefined,
      address: values.address || undefined,
      bio: values.bio || undefined,
    };
    onSubmit(data);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleFinish}
      initialValues={{ gender: 'male', generation: 1, sortOrder: 0 }}
      className="p-4"
    >
      <div className="text-lg font-semibold mb-4">
        {isEdit ? '编辑成员' : '新增成员'}
      </div>

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
        <Radio.Group onChange={(e) => setSelectedGender(e.target.value)}>
          <Radio value="male">男</Radio>
          <Radio value="female">女</Radio>
        </Radio.Group>
      </Form.Item>

      <Form.Item
        label="世数"
        name="generation"
        rules={[{ required: true, message: '请输入世数' }]}
      >
        <InputNumber min={1} max={100} style={{ width: '100%' }} placeholder="第几世" />
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
          onChange={handleParentChange}
        />
      </Form.Item>

      {selectedParentId && (
        <Form.Item label="同辈排行" name="sortOrder" tooltip="数字越小排越靠前（从左到右）">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="排行序号（自动分配）" />
        </Form.Item>
      )}

      {selectedParentId && orderPreview && (
        <div
          style={{
            marginBottom: 16,
            padding: '8px 12px',
            background: '#f6f8fa',
            borderRadius: 6,
            fontSize: 13,
            color: '#555',
          }}
        >
          <span style={{ marginRight: 12 }}>
            排行预览：
          </span>
          <Tag color="blue">{orderPreview.unifiedLabel}</Tag>
          <Tag color={selectedGender === 'male' ? 'geekblue' : 'magenta'}>
            {orderPreview.genderedLabel}
          </Tag>
          <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
            （共{orderPreview.totalCount}人，
            {selectedGender === 'male' ? '子' : '女'}{orderPreview.sameGenderCount}人）
          </span>
        </div>
      )}

      <Form.Item label="是否过继" valuePropName="checked">
        <Switch
          checked={isAdopted}
          onChange={(checked) => {
            setIsAdopted(checked);
            if (!checked) {
              form.setFieldsValue({ biologicalParentId: undefined });
            }
          }}
        />
        <span style={{ marginLeft: 8, color: '#666', fontSize: 12 }}>
          开启后可设置亲生父亲（上方"父亲"为养父/过继父亲）
        </span>
      </Form.Item>

      {isAdopted && (
        <>
          <Alert
            message="过继说明"
            description={'上方「父亲」为养父（族谱中的直系关系，实线连接），下方选择亲生父亲（虚线连接表示血缘关系）。'}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="亲生父亲"
            name="biologicalParentId"
            rules={[{ required: true, message: '请选择亲生父亲' }]}
          >
            <TreeSelect
              treeData={treeSelectData}
              placeholder="选择亲生父亲"
              allowClear
              showSearch
              treeDefaultExpandAll
              filterTreeNode={(input, node) =>
                (node?.title as string)?.toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: '100%' }}
            />
          </Form.Item>
        </>
      )}

      <Collapse
        ghost
        items={[
          {
            key: 'optional',
            label: '更多信息（可选）',
            children: (
              <div style={{ display: 'flex', gap: 16 }}>
                {/* 左栏：本人信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1677ff', marginBottom: 8 }}>本人信息</div>

                  <Form.Item label="别名" name="alias">
                    <Input placeholder="曾用名/乳名/艺名等" maxLength={50} />
                  </Form.Item>

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

                  <Form.Item label="个人简介" name="bio">
                    <TextArea rows={3} placeholder="个人简介" maxLength={1000} />
                  </Form.Item>

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
                </div>

                {/* 右栏：配偶信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#722ed1', marginBottom: 8 }}>配偶信息</div>

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
            ),
          },
        ]}
      />

      <Form.Item className="mt-4">
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            {isEdit ? '保存修改' : '添加成员'}
          </Button>
          <Button onClick={onCancel}>取消</Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

export default PersonForm;
