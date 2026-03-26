import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Form, Typography, message, Spin } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/bridge';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [form] = Form.useForm();

  useEffect(() => {
    api.auth
      .check()
      .then((res) => {
        if (res.loggedIn) {
          navigate('/edit', { replace: true });
          return;
        }
        setInitialized(res.initialized);
      })
      .catch(() => {
        setInitialized(false);
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleSetup = async (values: { password: string; confirm: string }) => {
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
      await api.auth.setup(values.password);
      message.success('密码设置成功');
      navigate('/edit', { replace: true });
    } catch (err: any) {
      message.error(err?.message || '设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (values: { password: string }) => {
    setLoading(true);
    try {
      const success = await api.auth.login(values.password);
      if (success) {
        navigate('/edit', { replace: true });
      } else {
        message.error('密码错误');
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
        bodyStyle={{ padding: '40px 32px' }}
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
            {initialized ? '请输入密码登录' : '首次使用，请设置密码'}
          </Text>
        </div>

        {initialized === false ? (
          <Form form={form} onFinish={handleSetup} layout="vertical">
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
                设置密码并进入
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <Form onFinish={handleLogin} layout="vertical">
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
      </Card>
    </div>
  );
};

export default LoginPage;
