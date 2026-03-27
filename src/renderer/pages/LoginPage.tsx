import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Form, Typography, message, Spin, Select, Modal } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/bridge';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [isV2, setIsV2] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [form] = Form.useForm();

  useEffect(() => {
    api.auth
      .check()
      .then((res) => {
        if (res.loggedIn && res.user) {
          setUser({
            id: res.user.id,
            username: res.user.username,
            displayName: res.user.displayName,
            role: res.user.role as any,
          });
          navigate('/tree', { replace: true });
          return;
        }
        setInitialized(res.initialized);
        setIsV2(res.v2 || false);
        setUsernames(res.usernames || []);
      })
      .catch(() => {
        setInitialized(false);
      })
      .finally(() => setChecking(false));
  }, [navigate, setUser]);

  // 首次设置（创建管理员）
  const handleSetup = async (values: {
    username: string;
    displayName: string;
    password: string;
    confirm: string;
  }) => {
    if (values.password !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    if (values.password.length < 4) {
      message.error('密码至少 4 位');
      return;
    }
    setLoading(true);
    try {
      const result = await api.auth.setup(values.username, values.password, values.displayName);
      setUser({
        id: result.user.id,
        username: result.user.username,
        displayName: result.user.displayName,
        role: result.user.role as any,
      });
      message.success('初始化成功');
      navigate('/tree', { replace: true });
    } catch (err: any) {
      message.error(err?.message || '设置失败');
    } finally {
      setLoading(false);
    }
  };

  // V1 登录（旧模式：只有密码）
  const handleV1Login = async (values: { password: string; username?: string }) => {
    setLoading(true);
    try {
      const result = await api.auth.login(values.username || 'admin', values.password);
      console.log('[V1Login] result:', JSON.stringify(result));
      if (result.success && result.user) {
        setUser({
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.displayName,
          role: result.user.role as any,
        });
        if (result.needMigration) {
          message.success('数据已升级为多用户模式，当前账号为管理员');
        }
        navigate('/tree', { replace: true });
      } else {
        message.error(result.error || '密码错误');
      }
    } catch (err: any) {
      console.error('[V1Login] error:', err);
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  // 忘记密码 - 重置数据
  const handleResetData = () => {
    Modal.confirm({
      title: '⚠️ 忘记密码 - 重置数据',
      content: (
        <div>
          <p>由于数据使用密码加密，忘记密码后<strong>无法恢复</strong>原有的加密数据。</p>
          <p>重置操作将：</p>
          <ul style={{ paddingLeft: 20 }}>
            <li>自动备份所有旧数据文件</li>
            <li>清除密码和加密数据</li>
            <li>回到首次初始化状态</li>
          </ul>
          <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>此操作不可逆！请确认你确实忘记了密码。</p>
        </div>
      ),
      okText: '确认重置',
      okType: 'danger',
      cancelText: '取消',
      width: 440,
      onOk: async () => {
        try {
          const result = await api.auth.resetData();
          if (result.success) {
            message.success('数据已重置，旧数据已备份到: ' + (result.backupDir || '备份目录'));
            // 刷新页面回到初始化状态
            window.location.reload();
          } else {
            message.error('重置失败: ' + (result.error || '未知错误'));
          }
        } catch (err: any) {
          message.error('重置失败: ' + (err?.message || '未知错误'));
        }
      },
    });
  };

  // V2 登录（多用户模式）
  const handleV2Login = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const result = await api.auth.login(values.username, values.password);
      if (result.success && result.user) {
        setUser({
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.displayName,
          role: result.user.role as any,
        });
        navigate('/tree', { replace: true });
      } else {
        message.error(result.error || '用户名或密码错误');
      }
    } catch (err: any) {
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{
          background: 'linear-gradient(135deg, #102a43 0%, #334e68 50%, #486581 100%)',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{
        background: 'linear-gradient(135deg, #102a43 0%, #334e68 50%, #486581 100%)',
      }}
    >
      <Card
        className="w-96 shadow-2xl"
        style={{ borderRadius: 12 }}
        styles={{ body: { padding: '40px 32px' } }}
      >
        <div className="text-center mb-8">
          <Title
            level={2}
            className="!mb-1"
            style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
          >
            FTree 家谱管理
          </Title>
          <Text type="secondary">
            {initialized === false
              ? '首次使用，请创建管理员账号'
              : isV2
                ? '请选择账号并输入密码'
                : '请输入密码登录'}
          </Text>
        </div>

        {/* 首次初始化 */}
        {initialized === false && (
          <Form form={form} onFinish={handleSetup} layout="vertical">
            <Form.Item
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 2, message: '用户名至少 2 位' },
                { max: 20, message: '用户名最多 20 位' },
                { pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, message: '仅支持中英文、数字和下划线' },
              ]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="管理员用户名"
                size="large"
              />
            </Form.Item>
            <Form.Item name="displayName">
              <Input
                prefix={<UserOutlined />}
                placeholder="显示名称（选填，默认同用户名）"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 4, message: '密码至少 4 位' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="设置密码"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              rules={[{ required: true, message: '请确认密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="确认密码"
                size="large"
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                创建管理员并进入
              </Button>
            </Form.Item>
          </Form>
        )}

        {/* V1 旧模式登录 */}
        {initialized === true && !isV2 && (
          <Form onFinish={handleV1Login} layout="vertical">
            <Form.Item name="username" initialValue="admin">
              <Input
                prefix={<UserOutlined />}
                placeholder="用户名（用于迁移后的管理员名）"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                size="large"
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                登 录
              </Button>
            </Form.Item>
            <div style={{ textAlign: 'center', marginTop: -8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                首次登录将自动升级为多用户模式
              </Text>
            </div>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Button type="link" size="small" danger onClick={handleResetData} style={{ fontSize: 12 }}>
                忘记密码？重置数据
              </Button>
            </div>
          </Form>
        )}

        {/* V2 多用户登录 */}
        {initialized === true && isV2 && (
          <Form onFinish={handleV2Login} layout="vertical">
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请选择或输入用户名' }]}
            >
              {usernames.length > 0 ? (
                <Select
                  placeholder="选择用户"
                  size="large"
                  showSearch
                  optionFilterProp="children"
                >
                  {usernames.map((name) => (
                    <Select.Option key={name} value={name}>
                      {name}
                    </Select.Option>
                  ))}
                </Select>
              ) : (
                <Input
                  prefix={<UserOutlined />}
                  placeholder="用户名"
                  size="large"
                />
              )}
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                size="large"
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                登 录
              </Button>
            </Form.Item>
          </Form>
        )}

        {/* V2 多用户登录 - 忘记密码 */}
        {initialized === true && isV2 && (
          <div style={{ textAlign: 'center', marginTop: -8 }}>
            <Button type="link" size="small" danger onClick={handleResetData} style={{ fontSize: 12 }}>
              忘记密码？重置数据
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default LoginPage;
