import React from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Tooltip } from 'antd';
import {
  EditOutlined,
  ApartmentOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import EditPage from './pages/EditPage';
import TreePage from './pages/TreePage';
import SettingsPage from './pages/SettingsPage';

interface NavItem {
  path: string;
  icon: React.ReactNode;
  label: string;
}

const navItems: NavItem[] = [
  { path: '/edit', icon: <EditOutlined />, label: '编辑管理' },
  { path: '/tree', icon: <ApartmentOutlined />, label: '家谱图' },
  { path: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const SideNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      className="flex flex-col items-center py-4 h-full"
      style={{
        width: 64,
        backgroundColor: '#102a43',
      }}
    >
      {/* Logo */}
      <div
        className="text-white font-serif font-bold text-lg mb-8 cursor-pointer"
        onClick={() => navigate('/edit')}
      >
        族
      </div>

      {/* 导航项 */}
      <div className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Tooltip key={item.path} title={item.label} placement="right">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer transition-all"
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
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppLayout />} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
