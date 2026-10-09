// Routes adapted from the official Ant Design Pro template.
export default [
  { path: '/user', layout: false, routes: [
    { path: '/user/login', name: 'login', component: './user/login' },
    { path: '/user', redirect: '/user/login' },
  ] },
  { path: '/dashboard', name: 'dashboard', icon: 'dashboard', routes: [
    { path: '/dashboard', redirect: '/dashboard/analysis' },
    { path: '/dashboard/analysis', name: 'analysis', component: './dashboard/analysis' },
  ] },
  { path: '/content', name: 'content', icon: 'read', access: 'canManageContent', routes: [
    { path: '/content', redirect: '/content/articles' },
    { path: '/content/articles', name: 'articles', component: './table-list' },
    { path: '/content/courses', name: 'courses', component: './courses' },
  ] },
  { path: '/list/table-list', redirect: '/content/articles' },
  { path: '/memberships', name: 'memberships', icon: 'crown', access: 'canAdmin', component: './memberships' },
  { path: '/products', name: 'products', icon: 'shopping', access: 'canManageContent', component: './products' },
  { path: '/delivery', name: 'delivery', icon: 'car', access: 'canEdit', component: './delivery' },
  { path: '/orders', name: 'orders', icon: 'profile', access: 'canViewOrders', component: './orders' },
  { path: '/data', name: 'data', icon: 'database', access: 'canData', component: './data-workbench' },
  { path: '/exception/403', component: './exception/403', hideInMenu: true },
  { path: '/exception/500', component: './exception/500', hideInMenu: true },
  { path: '/', redirect: '/dashboard/analysis' },
  { path: '/*', component: './exception/404' },
];
