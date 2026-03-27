import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Typography,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  StopOutlined,
  CheckCircleOutlined,
  UserOutlined,
  CrownOutlined,
  TeamOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { api } from '../api/bridge';
import { useAuth } from '../contexts/AuthContext';
import type { UserInfo, UserRole, CreateUserDTO, UpdateUserDTO } from '../types/person';

const { Title, Text } = Typography;

const roleLabels: Record<UserRole, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};

const roleColors: Record<UserRole, string> = {
  admin: 'red',
  editor: 'blue',
  viewer: 'default',
};

const roleIcons: Record<UserRole, React.ReactNode> = {
  admin: <CrownOutlined />,
  editor: <EditOutlined />,
  viewer: <EyeOutlined />,
};

const UserManagePage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [resetPwdVisible, setResetPwdVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetPwdForm] = Form.useForm();

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.users.list();
      setUsers(data);
    } catch (err: any) {
      message.error(err?.message || '加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // 创建用户
  const handleCreate = async (values: {
    username: string;
    displayName: string;
    password: string;
    confirm: string;
    role: UserRole;
  }) => {
    if (values.password !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    try {
      await api.users.create({
        username: values.username,
        displayName: values.displayName || values.username,
        password: values.password,
        role: values.role,
      });
      message.success('用户创建成功');
      setCreateVisible(false);
      createForm.resetFields();
      loadUsers();
    } catch (err: any) {
      message.error(err?.message || '创建失败');
    }
  };

  // 编辑用户
  const handleEdit = async (values: { displayName: string; role: UserRole }) => {
    if (!selectedUser) return;
    try {
      await api.users.update(selectedUser.id, {
        displayName: values.displayName,
        role: values.role,
      });
      message.success('用户信息已更新');
      setEditVisible(false);
      loadUsers();
    } catch (err: any) {
      message.error(err?.message || '更新失败');
    }
  };

  // 删除用户
  const handleDelete = async (id: string) => {
    try {
      await api.users.delete(id);
      message.success('用户已删除');
      loadUsers();
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  // 重置密码
  const handleResetPassword = async (values: { newPassword: string; confirm: string }) => {
    if (!selectedUser) return;
    if (values.newPassword !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    try {
      await api.users.resetPassword(selectedUser.id, values.newPassword);
      message.success(`已重置 ${selectedUser.displayName} 的密码`);
      setResetPwdVisible(false);
      resetPwdForm.resetFields();
    } catch (err: any) {
      message.error(err?.message || '重置密码失败');
    }
  };

  // 启用/禁用
  const handleToggle = async (id: string) => {
    try {
      await api.users.toggle(id);
      message.success('状态已更新');
      loadUsers();
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string, record: UserInfo) => (
        <Space>
          <UserOutlined />
          <span style={{ fontWeight: record.id === currentUser?.id ? 600 : 400 }}>
            {text}
          </span>
          {record.id === currentUser?.id && (
            <Tag color="green" style={{ fontSize: 11 }}>当前</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '显示名称',
      dataIndex: 'displayName',
      key: 'displayName',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: UserRole) => (
        <Tag icon={roleIcons[role]} color={roleColors[role]}>
          {roleLabels[role]}
        </Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, record: UserInfo) => (
        record.disabled
          ? <Tag color="error" icon={<StopOutlined />}>已禁用</Tag>
          : <Tag color="success" icon={<CheckCircleOutlined />}>正常</Tag>
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (text: string) =>
        text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: UserInfo) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedUser(record);
                editForm.setFieldsValue({
                  displayName: record.displayName,
                  role: record.role,
                });
                setEditVisible(true);
              }}
            />
          </Tooltip>
          <Tooltip title="重置密码">
            <Button
              type="text"
              size="small"
              icon={<LockOutlined />}
              onClick={() => {
                setSelectedUser(record);
                resetPwdForm.resetFields();
                setResetPwdVisible(true);
              }}
            />
          </Tooltip>
          <Tooltip title={record.disabled ? '启用' : '禁用'}>
            <Button
              type="text"
              size="small"
              icon={record.disabled ? <CheckCircleOutlined /> : <StopOutlined />}
              style={{ color: record.disabled ? '#52c41a' : '#ff4d4f' }}
              onClick={() => handleToggle(record.id)}
              disabled={record.id === currentUser?.id}
            />
          </Tooltip>
          <Popconfirm
            title={`确定要删除用户 "${record.displayName}" 吗？`}
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
            okType="danger"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.id === currentUser?.id}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Title level={3} className="!mb-0">
          <TeamOutlined className="mr-2" />
          用户管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            createForm.resetFields();
            setCreateVisible(true);
          }}
        >
          新建用户
        </Button>
      </div>

      {/* 角色权限说明 */}
      <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
        <Space split={<span style={{ color: '#d9d9d9' }}>|</span>}>
          <Text type="secondary">
            <CrownOutlined style={{ color: '#f5222d', marginRight: 4 }} />
            <strong>管理员</strong>：全部权限
          </Text>
          <Text type="secondary">
            <EditOutlined style={{ color: '#1890ff', marginRight: 4 }} />
            <strong>编辑者</strong>：查看、新增、编辑
          </Text>
          <Text type="secondary">
            <EyeOutlined style={{ marginRight: 4 }} />
            <strong>查看者</strong>：仅查看
          </Text>
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* 创建用户弹窗 */}
      <Modal
        title="新建用户"
        open={createVisible}
        onCancel={() => setCreateVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={createForm} onFinish={handleCreate} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 2, message: '用户名至少 2 位' },
              { max: 20, message: '用户名最多 20 位' },
              { pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, message: '仅支持中英文、数字和下划线' },
            ]}
          >
            <Input placeholder="用户名（登录用）" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="显示名称（选填，默认同用户名）" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            initialValue="viewer"
          >
            <Select>
              <Select.Option value="admin">
                <CrownOutlined style={{ color: '#f5222d', marginRight: 4 }} />管理员
              </Select.Option>
              <Select.Option value="editor">
                <EditOutlined style={{ color: '#1890ff', marginRight: 4 }} />编辑者
              </Select.Option>
              <Select.Option value="viewer">
                <EyeOutlined style={{ marginRight: 4 }} />查看者
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 4, message: '密码至少 4 位' },
            ]}
          >
            <Input.Password placeholder="初始密码" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认密码"
            rules={[{ required: true, message: '请确认密码' }]}
          >
            <Input.Password placeholder="确认密码" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
              <Button onClick={() => setCreateVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户弹窗 */}
      <Modal
        title={`编辑用户 — ${selectedUser?.username}`}
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={editForm} onFinish={handleEdit} layout="vertical">
          <Form.Item
            name="displayName"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="显示名称" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select>
              <Select.Option value="admin">
                <CrownOutlined style={{ color: '#f5222d', marginRight: 4 }} />管理员
              </Select.Option>
              <Select.Option value="editor">
                <EditOutlined style={{ color: '#1890ff', marginRight: 4 }} />编辑者
              </Select.Option>
              <Select.Option value="viewer">
                <EyeOutlined style={{ marginRight: 4 }} />查看者
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
              <Button onClick={() => setEditVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal
        title={`重置密码 — ${selectedUser?.displayName}`}
        open={resetPwdVisible}
        onCancel={() => setResetPwdVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={resetPwdForm} onFinish={handleResetPassword} layout="vertical">
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 4, message: '密码至少 4 位' },
            ]}
          >
            <Input.Password placeholder="新密码" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认密码"
            rules={[{ required: true, message: '请确认密码' }]}
          >
            <Input.Password placeholder="确认密码" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                重置密码
              </Button>
              <Button onClick={() => setResetPwdVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UserManagePage;
