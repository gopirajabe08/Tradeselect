import { defineConfig } from '@umijs/max';

// Route list is kept lean: only what a paper-trading tool needs.
// Removed: Broking, Wallet, My Plans, Pricing, Social Build, Odyssey, Vault,
// Phoenix (duplicate of Genie), pythonbuild (duplicate), python (duplicate),
// build/python (duplicate). The stub pages still exist but aren't routed or
// shown in the sider.
export default defineConfig({
  title: 'TradeSelect',
  favicons: ['/favicon.svg'],
  antd: {
    configProvider: {
      theme: {
        token: { colorPrimary: '#1677ff' },
      },
    },
  },
  access: {},
  model: {},
  initialState: {},
  request: {},
  layout: {},
  hash: true,
  history: { type: 'browser' },
  npmClient: 'npm',
  proxy: {
    '/api': { target: 'http://localhost:4000', changeOrigin: true },
    '/_sim': { target: 'http://localhost:4000', changeOrigin: true },
  },
  routes: [
    { path: '/', redirect: '/dashboard' },

    // Auth layout (centered, no sidebar)
    {
      path: '/user',
      layout: false,
      routes: [
        { path: '/user', redirect: '/user/login' },
        { path: '/user/login', component: './user/login' },
        { path: '/user/register', component: './user/register' },
        { path: '/user/brokerlogin', component: './user/brokerlogin' },
      ],
    },

    // Main app — core paper-trading workflow
    { path: '/loading', component: './loading', layout: false },
    { path: '/dashboard', component: './dashboard', name: 'Dashboard' },
    { path: '/portfolio', component: './portfolio', name: 'Portfolio' },

    {
      path: '/book',
      name: 'Book',
      routes: [
        { path: '/book', redirect: '/book/trade' },
        { path: '/book/trade', component: './book/trade', name: 'Trade Book' },
        { path: '/book/pl', component: './book/pl', name: 'P&L Book' },
      ],
    },

    {
      path: '/marketplace',
      name: 'Marketplace',
      routes: [
        { path: '/marketplace', component: './marketplace' },
        { path: '/marketplace/category/retail', component: './marketplace/category/retail' },
        { path: '/marketplace/category/premium', component: './marketplace/category/premium' },
        { path: '/marketplace/category/hni', component: './marketplace/category/hni' },
      ],
    },

    // Strategy authoring (Python Monaco editor)
    {
      path: '/strategies',
      name: 'Strategies',
      routes: [
        { path: '/strategies', redirect: '/strategies/saved' },
        { path: '/strategies/saved', component: './genie/saved-strategies', name: 'Saved' },
        { path: '/strategies/editor', component: './genie/codeEditor', name: 'Code Editor' },
      ],
    },

    { path: '/settings', component: './settings', name: 'Settings' },
    { path: '/profiling', component: './profiling', name: 'Profile' },

    {
      path: '/help',
      name: 'Help',
      routes: [
        { path: '/help', component: './help' },
        { path: '/help/searchResult', component: './help/searchResult' },
        { path: '/help/article/:slug', component: './help/article' },
      ],
    },

    // Documents (public, no sidebar)
    {
      path: '/documents',
      layout: false,
      routes: [
        { path: '/documents', component: './documents' },
        { path: '/documents/disclaimer', component: './documents/disclaimer' },
        { path: '/documents/privacy-policy', component: './documents/privacy-policy' },
        { path: '/documents/refund-policy', component: './documents/refund-policy' },
        { path: '/documents/terms-conditions-of-use', component: './documents/terms-conditions-of-use' },
      ],
    },

    { path: '*', component: './404' },
  ],
});
