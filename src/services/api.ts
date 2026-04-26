import { request } from '@umijs/max';

// Thin wrapper that routes every call through Umi's proxied /api prefix.
// In dev this hits the mock backend on :4000; in prod it hits the real API Gateway.
function call<T>(pathPart: string, params?: Record<string, unknown>, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const url = `/api${pathPart}`;
  if (method === 'GET') {
    return request<T>(url, { method, params });
  }
  return request<T>(url, { method, data: params });
}

const LIVE_PARAMS = { isLive: 'true', location: 'en-IN' };

// --- Types ---

export type PaginatedTable<T = Record<string, unknown>> = {
  data: T[];
  total: number;
  pageSize: number;
  currentPage: number;
};

export type TableColumnsResponse = {
  columns: Array<{ title?: string; dataIndex?: string; key?: string; width?: number | string; valueType?: string; [k: string]: unknown }>;
};

export type SiteDetails = {
  site: unknown;
  siteTheme: unknown;
  routes: Array<{ name: string; path: string; icon?: string; children?: unknown[] }>;
  bottomNavRoutes?: unknown;
  support?: unknown;
  helpSite?: unknown;
  collapsedSidebar?: boolean;
  enableChatbot?: boolean;
};

export type UserProfile = {
  details: Record<string, unknown>;
  name: string;
  money: number | string;
  avatar?: string;
  userid: string;
  email: string;
  phone: string;
  aadharCard?: string;
};

// --- Shared ---

export const getSiteDetails = () => call<SiteDetails>('/v1/site/details', {
  val: '["site","siteTheme","routes","bottomNavRoutes","support","helpSite"]',
  ...LIVE_PARAMS,
});
export const getUserProfile = () => call<UserProfile>('/v4/user/profile', LIVE_PARAMS);
export const getNotice = () => call<unknown>('/v3/notice', { ...LIVE_PARAMS, initial: 'true' });
export const getPagesDescription = () => call<unknown>('/v2/pages/data/description', LIVE_PARAMS);
export const getPackageMeta = () => call<unknown>('/v1/package/meta', LIVE_PARAMS);

// --- Dashboard ---

export const getDashboardAccountInfo = () => call<Record<string, unknown>>('/v1/dashboard/accountInfo', LIVE_PARAMS);
export const getDashboardBrokerInfo = () => call<Record<string, unknown>>('/v1/dashboard/brokerInfo', LIVE_PARAMS);
export const getDashboardSubscriptionInfo = () => call<Record<string, unknown>>('/v1/dashboard/subscriptionInfo', LIVE_PARAMS);
export const getDashboardProfileInfo = () => call<Record<string, unknown>>('/v1/dashboard/profileInfo', LIVE_PARAMS);
export const getDashboardProgression = () => call<Record<string, unknown>>('/v1/dashboard/progression', LIVE_PARAMS);

export const getDashboardPortfolioColumns = () => call<TableColumnsResponse>('/v1/dashboard/portfolio/columns', LIVE_PARAMS);
export const getDashboardPortfolioData = (params: { pageSize?: number; currentPage?: number; sort?: string; sortDays?: number } = {}) =>
  call<PaginatedTable>('/v1/dashboard/portfolio/data', {
    pageSize: 5, currentPage: 1, sort: 'mostUsed', sortDays: 7, ...params, ...LIVE_PARAMS,
  });

export const getDashboardAlgoOrders = (params: { pageSize?: number; currentPage?: number; type?: string } = {}) =>
  call<PaginatedTable>('/v1/dashboard/algoOrders', {
    pageSize: 5, currentPage: 1, type: 'pnlBook', ...params, ...LIVE_PARAMS,
  });

export const getDashboardAnalytics = (params: { product?: string; duration?: string } = {}) =>
  call<Record<string, unknown>>('/v1/dashboard/analytics', {
    isMetadata: 'true', getFilters: 'true', feVersion: '2024.12.1', ...params, ...LIVE_PARAMS,
  });

// --- Portfolio ---

export const getPortfolioColumns = () => call<TableColumnsResponse>('/v5/portfolio/columns', LIVE_PARAMS);
export const getPortfolioMeta = () => call<Record<string, unknown>>('/v5/portfolio/meta', LIVE_PARAMS);
export const getPortfolioStrategies = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v6/portfolio/strategies', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });

// --- Book (Trade/Fund/PnL) ---

export const getBookTradeColumns = () => call<TableColumnsResponse>('/v4/book/trade/columns', LIVE_PARAMS);
export const getBookTradeData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/book/trade/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getBookTradeChart = () => call<Record<string, unknown>>('/v4/book/trade/chart/0', LIVE_PARAMS);
export const getBookTradeFilter = () => call<Record<string, unknown>>('/v5/book/trade/filter', LIVE_PARAMS);

export const getBookPLColumns = () => call<TableColumnsResponse>('/v4/book/pl/columns', LIVE_PARAMS);
export const getBookPLData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/book/pl/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getBookPLChart = () => call<Record<string, unknown>>('/v4/book/pl/chart/0', LIVE_PARAMS);
export const getBookPLFilter = () => call<Record<string, unknown>>('/v5/book/pl/filter', LIVE_PARAMS);

export const getBookFundData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/book/fund/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });

// --- Broking ---

export const getBrokingColumns = () => call<TableColumnsResponse>('/v3/user/broking/columns', LIVE_PARAMS);
export const getBrokingData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v3/user/broking/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });

// --- Settings / Profile ---

export const getUserProfileForm = () => call<Record<string, unknown>>('/v3/user/profile/form', LIVE_PARAMS);

// --- Wallet / Plans ---

export const getWalletPricing = () => call<Record<string, unknown>>('/v2/wallet/pricing', LIVE_PARAMS);
export const getWalletPayAsYouGoColumn = () => call<TableColumnsResponse>('/v3/wallet/payasyougo/column', LIVE_PARAMS);
export const getWalletPayAsYouGoData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v3/wallet/payasyougo/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getWalletAlgoform = () => call<Record<string, unknown>>('/v4/wallet/algoform', LIVE_PARAMS);
export const getWalletActivePlansColumn = () => call<TableColumnsResponse>('/v4/wallet/myplans/activeplans/column', LIVE_PARAMS);
export const getWalletActivePlansData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/wallet/myplans/activeplans/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getWalletExpiredPlansColumn = () => call<TableColumnsResponse>('/v4/wallet/myplans/expiredplans/column', LIVE_PARAMS);
export const getWalletExpiredPlansData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/wallet/myplans/expiredplans/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getWalletTransactionsColumn = () => call<TableColumnsResponse>('/v4/wallet/transactions/column', LIVE_PARAMS);

// --- Strategy / Marketplace ---

export const getStrategy = (params: { category?: string; pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v4/strategy', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getStrategyColumns = () => call<TableColumnsResponse>('/v4/strategy/columns', LIVE_PARAMS);
export const getStrategyFilter = () => call<Record<string, unknown>>('/v5/strategy/filter', LIVE_PARAMS);

// --- Phoenix ---

export const getPhoenixClassicBuilders = () => call<Record<string, unknown>>('/v1/phoenix/classic/builders', LIVE_PARAMS);
export const getPhoenixSavedColumns = () => call<TableColumnsResponse>('/v1/phoenix/saved/strategies/columns', LIVE_PARAMS);
export const getPhoenixSavedData = (params: { pageSize?: number; currentPage?: number } = {}) =>
  call<PaginatedTable>('/v1/phoenix/saved/strategies/data', { pageSize: 10, currentPage: 1, ...params, ...LIVE_PARAMS });
export const getPhoenixTemplatesFilters = () => call<Record<string, unknown>>('/v1/phoenix/strategy/templates/filters', LIVE_PARAMS);

// --- Python Build ---

export const getPythonBuildMeta = () => call<Record<string, unknown>>('/v4/build/python/user/meta', LIVE_PARAMS);

// --- Social Build ---

export const getSocialBuildStrategyTweak = () => call<Record<string, unknown>>('/v2/socialbuild/strategyTweak', LIVE_PARAMS);

// --- Profiling ---

export const getUserProfiling = () => call<Record<string, unknown>>('/v1/user/profiling', LIVE_PARAMS);

// --- Generic helpers ---

export { call as rawApiCall };
