import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/index.css';
import './styles/tree.css';

const themeConfig = {
  token: {
    colorPrimary: '#334e68',
    borderRadius: 6,
    fontFamily: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
