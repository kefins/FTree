import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Upload, Typography, Space, Divider, Modal, Checkbox, Tooltip } from 'antd';
import {
  DownloadOutlined,
  UploadOutlined,
  SaveOutlined,
  LockOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  BgColorsOutlined,
  BookOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { api } from '../api/bridge';
import GenerationColorConfig from '../components/GenerationColorConfig';
import GenerationCharConfig from '../components/GenerationCharConfig';

const { Title, Text, Paragraph } = Typography;

const SettingsPage: React.FC = () => {
  const [pwdLoading, setPwdLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [colorConfigVisible, setColorConfigVisible] = useState(false);
  const [charConfigVisible, setCharConfigVisible] = useState(false);
  const [pwdForm] = Form.useForm();

  // 数据路径相关状态
  const [dataPath, setDataPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [dataPathLoading, setDataPathLoading] = useState(false);
  const isElectron = !!(window as any).ftreeAPI;

  // 加载当前数据路径
  useEffect(() => {
    if (isElectron) {
      api.config.getDataPath().then((res) => {
        setDataPath(res.current);
        setDefaultPath(res.default);
      }).catch(() => {});
    }
  }, [isElectron]);

  // 选择新的数据目录
  const handleSelectDataPath = async () => {
    try {
      const selected = await api.config.selectDataPath();
      if (!selected) return; // 用户取消

      Modal.confirm({
        title: '修改数据存储位置',
        icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
        width: 520,
        content: (
          <div>
            <p>新的存储位置：</p>
            <p style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '8px 12px', borderRadius: 6, wordBreak: 'break-all', fontSize: 13 }}>
              {selected}
            </p>
            <Divider style={{ margin: '12px 0' }} />
            <Checkbox id="migrateCheck" defaultChecked>
              迁移现有数据到新目录
            </Checkbox>
            <div style={{ marginTop: 4, fontSize: 12, color: '#999', paddingLeft: 24 }}>
              勾选后会将当前目录的所有数据文件复制到新目录
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffe58f' }}>
              <Text type="warning" style={{ fontSize: 12 }}>
                ⚠ 修改后需要重启应用才能生效。请确保新目录有足够的磁盘空间和写入权限。
              </Text>
            </div>
          </div>
        ),
        okText: '确认修改',
        cancelText: '取消',
        onOk: async () => {
          setDataPathLoading(true);
          try {
            // 读取勾选框状态
            const checkbox = document.getElementById('migrateCheck') as HTMLInputElement;
            const migrate = checkbox?.checked ?? true;
            const resultPath = await api.config.setDataPath(selected, migrate);
            setDataPath(resultPath);
            message.success('数据存储位置已修改，请重启应用使其完全生效');
          } catch (err: any) {
            message.error(err?.message || '修改数据路径失败');
          } finally {
            setDataPathLoading(false);
          }
        },
      });
    } catch (err: any) {
      message.error(err?.message || '选择目录失败');
    }
  };

  // 恢复默认数据路径
  const handleResetDataPath = () => {
    if (dataPath === defaultPath) {
      message.info('当前已是默认路径');
      return;
    }
    Modal.confirm({
      title: '恢复默认存储位置',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p>将数据存储位置恢复为默认路径：</p>
          <p style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '8px 12px', borderRadius: 6, wordBreak: 'break-all', fontSize: 13 }}>
            {defaultPath}
          </p>
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffe58f' }}>
            <Text type="warning" style={{ fontSize: 12 }}>
              ⚠ 恢复后需要重启应用。请确保默认目录中有相应的数据文件，否则将看到空数据。
            </Text>
          </div>
        </div>
      ),
      okText: '确认恢复',
      cancelText: '取消',
      onOk: async () => {
        setDataPathLoading(true);
        try {
          const resultPath = await api.config.resetDataPath();
          setDataPath(resultPath);
          message.success('已恢复为默认路径，请重启应用使其完全生效');
        } catch (err: any) {
          message.error(err?.message || '恢复默认路径失败');
        } finally {
          setDataPathLoading(false);
        }
      },
    });
  };

  const handleChangePassword = async (values: {
    oldPassword: string;
    newPassword: string;
    confirm: string;
  }) => {
    if (values.newPassword !== values.confirm) {
      message.error('两次输入的新密码不一致');
      return;
    }
    if (values.newPassword.length < 4) {
      message.error('密码至少 4 位');
      return;
    }
    setPwdLoading(true);
    try {
      // 先验证旧密码
      const success = await api.auth.login(values.oldPassword);
      if (!success) {
        message.error('当前密码错误');
        return;
      }
      await api.auth.setup(values.newPassword);
      message.success('密码修改成功');
      pwdForm.resetFields();
    } catch (err: any) {
      message.error(err?.message || '修改密码失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const data = await api.data.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ftree_export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('数据导出成功');
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportData = async (file: File) => {
    setImportLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        message.error('数据格式不正确，需要 JSON 数组');
        return;
      }
      await api.data.import(data);
      message.success(`成功导入 ${data.length} 条数据`);
    } catch (err: any) {
      message.error(err?.message || '导入失败，请检查文件格式');
    } finally {
      setImportLoading(false);
    }
  };

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      const path = await api.data.backup();
      message.success(`备份创建成功：${path}`);
    } catch (err: any) {
      message.error(err?.message || '备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleClearData = () => {
    Modal.confirm({
      title: '危险操作：清除所有家族数据',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p style={{ color: '#ff4d4f', fontWeight: 600, marginBottom: 8 }}>
            此操作将永久删除所有已录入的家族成员数据！
          </p>
          <p>删除后数据无法恢复，建议先导出备份。</p>
          <p>确定要继续吗？</p>
        </div>
      ),
      okText: '确认清除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearLoading(true);
        try {
          await api.data.clear();
          message.success('所有家族数据已清除');
          // 刷新页面以重置所有状态
          setTimeout(() => window.location.reload(), 500);
        } catch (err: any) {
          message.error(err?.message || '清除失败');
        } finally {
          setClearLoading(false);
        }
      },
    });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <Title level={3}>设置</Title>

      {/* 安全设置 */}
      <Card title={<><LockOutlined className="mr-2" />安全设置</>}>
        <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword}>
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password placeholder="当前密码" />
          </Form.Item>
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
            label="确认新密码"
            rules={[{ required: true, message: '请确认新密码' }]}
          >
            <Input.Password placeholder="确认新密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pwdLoading}>
            修改密码
          </Button>
        </Form>
      </Card>

      {/* 显示设置 */}
      <Card title={<><BgColorsOutlined className="mr-2" />显示设置</>}>
        <Space direction="vertical" className="w-full" size="middle">
          <div>
            <Paragraph type="secondary" className="!mb-2">
              自定义每一世节点的颜色方案，让族谱图更加直观美观。
            </Paragraph>
            <Button
              icon={<BgColorsOutlined />}
              onClick={() => setColorConfigVisible(true)}
            >
              世代配色设置
            </Button>
          </div>
          <Divider className="!my-2" />
          <div>
            <Paragraph type="secondary" className="!mb-2">
              管理家族字辈（派语），为每一世设置辈分字，用于取名参考和族谱展示。
            </Paragraph>
            <Button
              icon={<BookOutlined />}
              onClick={() => setCharConfigVisible(true)}
            >
              字辈管理
            </Button>
          </div>
        </Space>
      </Card>

      {/* 数据存储位置（仅 Electron 模式） */}
      {isElectron && (
        <Card title={<><FolderOutlined className="mr-2" />数据存储位置</>}>
          <Space direction="vertical" className="w-full" size="middle">
            <div>
              <Paragraph type="secondary" className="!mb-2">
                配置家谱数据文件的存储位置。修改后需要重启应用才能完全生效。
              </Paragraph>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: '#f6f6f6',
                  borderRadius: 6,
                  border: '1px solid #e8e8e8',
                  marginBottom: 12,
                }}
              >
                <FolderOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    wordBreak: 'break-all',
                  }}
                >
                  {dataPath || '加载中...'}
                </Text>
                {dataPath && dataPath !== defaultPath && (
                  <Tooltip title="当前使用自定义路径">
                    <Text type="warning" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      自定义
                    </Text>
                  </Tooltip>
                )}
              </div>
              <Space>
                <Button
                  icon={<FolderOpenOutlined />}
                  onClick={handleSelectDataPath}
                  loading={dataPathLoading}
                >
                  更改位置
                </Button>
                {dataPath && dataPath !== defaultPath && (
                  <Button
                    icon={<UndoOutlined />}
                    onClick={handleResetDataPath}
                    loading={dataPathLoading}
                  >
                    恢复默认
                  </Button>
                )}
              </Space>
            </div>
          </Space>
        </Card>
      )}

      {/* 数据管理 */}
      <Card title={<><SaveOutlined className="mr-2" />数据管理</>}>
        <Space direction="vertical" className="w-full" size="middle">
          <div>
            <Paragraph type="secondary" className="!mb-2">
              导出所有数据为 JSON 文件，可用于备份或迁移。
            </Paragraph>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportData}
              loading={exportLoading}
            >
              导出数据
            </Button>
          </div>

          <Divider className="!my-2" />

          <div>
            <Paragraph type="secondary" className="!mb-2">
              从 JSON 文件导入数据，将覆盖现有数据。
            </Paragraph>
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={(file) => {
                handleImportData(file);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={importLoading}>
                导入数据
              </Button>
            </Upload>
          </div>

          <Divider className="!my-2" />

          <div>
            <Paragraph type="secondary" className="!mb-2">
              创建数据备份，备份文件保存在本地。
            </Paragraph>
            <Button
              icon={<SaveOutlined />}
              onClick={handleBackup}
              loading={backupLoading}
            >
              创建备份
            </Button>
          </div>

          <Divider className="!my-2" />

          <div>
            <Paragraph type="danger" className="!mb-2">
              清除所有家族成员数据，此操作不可恢复，请谨慎执行。
            </Paragraph>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleClearData}
              loading={clearLoading}
            >
              清除所有数据
            </Button>
          </div>
        </Space>
      </Card>

      {/* 关于 */}
      <Card title={<><InfoCircleOutlined className="mr-2" />关于</>}>
        <div className="space-y-1">
          <div>
            <Text strong>FTree 家谱管理系统</Text>
          </div>
          <div>
            <Text type="secondary">版本：1.0.0</Text>
          </div>
          <div>
            <Text type="secondary">记录家族传承，铭刻世代印记。</Text>
          </div>
        </div>
      </Card>

      <GenerationColorConfig
        visible={colorConfigVisible}
        onClose={() => setColorConfigVisible(false)}
      />

      <GenerationCharConfig
        visible={charConfigVisible}
        onClose={() => setCharConfigVisible(false)}
      />
    </div>
  );
};

export default SettingsPage;
