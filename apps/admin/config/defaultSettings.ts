import type { ProLayoutProps } from '@ant-design/pro-components';

/**
 * @name
 */
const Settings: ProLayoutProps & {
  logo?: string;
  locale?: boolean;
} = {
  navTheme: 'light',
  colorPrimary: '#235663',
  layout: 'side',
  siderWidth: 232,
  contentWidth: 'Fluid',
  fixedHeader: true,
  fixSiderbar: true,
  colorWeak: false,
  // ProLayout types locale as undefined; the layout reads this flag to hide the language menu.
  locale: false as unknown as undefined,
  title: '老子道学书院',
  logo: '/logo.svg',
  iconfontUrl: '',
  token: {
    header: { colorBgHeader: '#FBF8F1', heightLayoutHeader: 56 },
    sider: {
      colorMenuBackground: '#FBF8F1',
      colorTextMenuSelected: '#235663',
      colorBgMenuItemSelected: '#EFE9DA',
    },
    pageContainer: {
      paddingInlinePageContainerContent: 24,
      paddingBlockPageContainerContent: 20,
    },
  },
};

export default Settings;
