import React from 'react';
import { Dropdown } from 'antd';
import { LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import { logout } from '@/services/auth';

export const AvatarDropdown: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { refresh } = useModel('@@initialState');
  const onClick = async ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout();
      await refresh();
      history.push('/user/login');
      return;
    }
    if (key === 'settings') history.push('/settings');
    if (key === 'profile') history.push('/profiling');
  };
  return (
    <Dropdown
      menu={{
        onClick,
        items: [
          { key: 'profile', icon: <UserOutlined />, label: 'Profile' },
          { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
          { type: 'divider' },
          { key: 'logout', icon: <LogoutOutlined />, label: 'Logout' },
        ],
      }}
    >
      {children as any}
    </Dropdown>
  );
};
