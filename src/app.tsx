import type { RunTimeLayoutConfig } from '@umijs/max';
import { history } from '@umijs/max';
import { AvatarDropdown } from '@/components/AvatarDropdown';
import { Logo } from '@/components/Logo';
import { getCurrentUser, type AuthUser } from '@/services/auth';

const PUBLIC_PATH_PREFIXES = ['/user', '/documents'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function getInitialState(): Promise<{
  currentUser: AuthUser | null;
  theme?: 'light' | 'dark';
}> {
  const currentUser = getCurrentUser();
  return {
    currentUser,
    theme: (typeof window !== 'undefined' && (localStorage.getItem('theme') as 'light' | 'dark')) || 'light',
  };
}

export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  return {
    title: 'TradeSelect',
    logo: <Logo />,
    menu: { locale: false },
    layout: 'mix',
    splitMenus: false,
    fixedHeader: true,
    fixSiderbar: true,
    siderWidth: 224,
    avatarProps: {
      title: initialState?.currentUser?.name ?? 'Guest',
      size: 'small',
      render: (_, dom) => <AvatarDropdown>{dom}</AvatarDropdown>,
    },
    token: {
      header: { colorBgHeader: '#001529', colorTextMenu: '#fff' },
      sider: { colorMenuBackground: '#001529', colorTextMenu: '#bfbfbf', colorTextMenuSelected: '#fff', colorBgMenuItemSelected: '#1677ff' },
    },
    onPageChange: () => {
      const { pathname } = history.location;
      if (!getCurrentUser() && !isPublicPath(pathname)) {
        history.replace('/user/login');
      }
    },
  };
};
