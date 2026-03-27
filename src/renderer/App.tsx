import React from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Tooltip, Dropdown, Avatar } from 'antd';
import type { MenuProps } from 'antd';
import {
  EditOutlined,
  ApartmentOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  CrownOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import EditPage from './pages/EditPage';
import TreePage from './pages/TreePage';
import SettingsPage from './pages/SettingsPage';
import UserManagePage from './pages/UserManagePage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { UserRole } from './types/person';

interface NavItem {
  path: string;
  icon: React.ReactNode;
  label: string;
  /** 需要的最低角色 */
  minRole?: UserRole;
}

const allNavItems: NavItem[] = [
  { path: '/tree', icon: <ApartmentOutlined />, label: '家谱图' },
  { path: '/edit', icon: <EditOutlined />, label: '编辑管理', minRole: 'editor' },
  { path: '/users', icon: <TeamOutlined />, label: '用户管理', minRole: 'admin' },
  { path: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const roleLevel: Record<UserRole, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

const roleIcons: Record<UserRole, React.ReactNode> = {
  admin: <CrownOutlined style={{ color: '#f5222d' }} />,
  editor: <EditOutlined style={{ color: '#1890ff' }} />,
  viewer: <EyeOutlined style={{ color: '#8c8c8c' }} />,
};

const roleLabels: Record<UserRole, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};

const SideNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const userRole = user?.role || 'viewer';

  // 根据角色过滤导航项
  const navItems = allNavItems.filter((item) => {
    if (!item.minRole) return true;
    return roleLevel[userRole] >= roleLevel[item.minRole];
  });

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 600 }}>{user?.displayName}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {roleIcons[userRole]} {roleLabels[userRole]}
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: logout,
    },
  ];

  const [logoBounce, setLogoBounce] = React.useState(false);

  const handleLogoClick = () => {
    // 触发弹跳动画
    setLogoBounce(true);
    setTimeout(() => setLogoBounce(false), 500);
    // 如果已在 /tree 页面，触发页面刷新（通过先导航到空路径再回来）
    if (location.pathname === '/tree') {
      navigate('/tree', { replace: true });
      // 通过 window 派发自定义事件让 TreePage 可以响应
      window.dispatchEvent(new CustomEvent('ftree-logo-click'));
    } else {
      navigate('/tree');
    }
  };

  return (
    <div
      className="flex flex-col items-center"
      style={{
        width: 64,
        height: '100%',
        backgroundColor: '#102a43',
        overflow: 'hidden',
      }}
    >
      {/* Logo - 固定顶部 */}
      <div
        className="flex-shrink-0 flex items-center justify-center cursor-pointer select-none"
        style={{
          width: '100%',
          height: 56,
        }}
        onClick={handleLogoClick}
        title="回到家谱图"
      >
        <span
          className="text-white font-serif font-bold"
          style={{
            fontSize: 22,
            transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: logoBounce ? 'scale(1.4) rotate(-8deg)' : 'scale(1)',
            display: 'inline-block',
          }}
        >
          族
        </span>
      </div>

      {/* 导航项 - 中间弹性区域 */}
      <div className="flex flex-col gap-2 flex-1 items-center" style={{ overflow: 'hidden', paddingTop: 8 }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Tooltip key={item.path} title={item.label} placement="right">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer transition-all flex-shrink-0"
                style={{
                  backgroundColor: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                  color: isActive ? '#ffffff' : '#9fb3c8',
                }}
                onClick={() => navigate(item.path)}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor =
                      'rgba(255,255,255,0.08)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                  }
                }}
              >
                <span className="text-xl">{item.icon}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>

      {/* 用户头像/菜单 - 固定底部 */}
      {user && (
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '100%', height: 56 }}>
        <Dropdown menu={{ items: userMenuItems }} placement="topRight" trigger={['click']}>
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer"
            style={{ color: '#9fb3c8' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.backgroundColor =
                'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
            }}
          >
            <Avatar
              size={28}
              style={{ backgroundColor: '#334e68', fontSize: 12 }}
              icon={<UserOutlined />}
            >
              {user.displayName?.[0]}
            </Avatar>
          </div>
        </Dropdown>
        </div>
      )}
    </div>
  );
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const isLoginPage = location.pathname === '/';

  if (isLoginPage) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen">
      <SideNav />
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/edit" element={<EditPage />} />
          <Route path="/tree" element={<TreePage />} />
          <Route path="/users" element={<UserManagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<AppLayout />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
};

export default App;
