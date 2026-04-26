import { request } from '@umijs/max';

export type DataSource = 'live' | 'delayed' | 'cached-baseline' | 'gbm-fallback';
export type Instrument = {
  code: string;
  exchange: string;
  basePrice: number;
  currentPrice: number;
  dataSource?: DataSource;
};
export type Instance = {
  id: number;
  strategyCode: string;
  strategyName: string;
  strategyType: string;
  instrument: string;
  exchange: string;
  capital: number;
  mode: 'BT' | 'PT' | 'LT';
  status: 'RUNNING' | 'STOPPED';
  startedAt: string;
  stoppedAt: string | null;
  position: { entryPrice: number; quantity: number; entryAt: string } | null;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeIds: number[];
};
export type Trade = {
  id: number;
  instanceId: number;
  instrument: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  value: number;
  pnl: number;
  reason: string;
  timestamp: string;
};

export function listInstruments(): Promise<Instrument[]> {
  return request<Instrument[]>('/_sim/instruments', { method: 'GET' });
}

export function startStrategy(input: {
  strategyCode: string;
  strategyName?: string;
  strategyType?: string;
  instrument: string;
  exchange?: string;
  capital: number;
  mode?: 'BT' | 'PT' | 'LT';
}): Promise<{ ok: boolean; instance: Instance }> {
  return request('/api/_sim/strategy/start', { method: 'POST', data: input });
}

export function stopStrategy(id: number): Promise<{ ok: boolean; instance: Instance }> {
  return request(`/api/_sim/strategy/stop/${id}`, { method: 'POST' });
}

export function deleteInstance(id: number): Promise<{ ok: boolean }> {
  return request(`/api/_sim/strategy/${id}`, { method: 'DELETE' });
}

export function listInstances(): Promise<{ data: Instance[] }> {
  return request('/api/_sim/strategy/instances', { method: 'GET' });
}

export function listTrades(instanceId?: number): Promise<{ data: Trade[] }> {
  return request('/api/_sim/trades', { method: 'GET', params: instanceId != null ? { instanceId } : {} });
}

export function simStatus(): Promise<{ lastTickAt: string; prices: Record<string, number>; instanceCount: number; running: number; tradeCount: number }> {
  return request('/_sim/status', { method: 'GET' });
}

export function firstPriceOfHistory(code: string): Promise<number | null> {
  return priceHistory(code).then((r) => r.data[0]?.price ?? null).catch(() => null);
}

export type AlgoMeta = { key: string; name: string; description: string; defaultParams: Record<string, unknown> };
export function listAlgos(): Promise<{ algos: AlgoMeta[]; mapping: Record<string, string> }> {
  return request('/_sim/algos', { method: 'GET' });
}

export type PricePoint = { t: number; price: number };
export function priceHistory(instrument: string): Promise<{ instrument: string; data: PricePoint[] }> {
  return request(`/_sim/history/price/${instrument}`, { method: 'GET' });
}

export type PnlPoint = { t: string; price: number; realized: number; unrealized: number; total: number };
export function pnlHistory(instanceId: number): Promise<{ instanceId: number; data: PnlPoint[] }> {
  return request(`/_sim/history/pnl/${instanceId}`, { method: 'GET' });
}

export function pnlHistoryAll(opts: { onlyRunning?: boolean; bucket?: 'minute' | 'hour' } = {}): Promise<{ series: Record<string, PnlPoint[]>; bucket?: string }> {
  const params: Record<string, string> = {};
  if (opts.onlyRunning) params.onlyRunning = 'true';
  if (opts.bucket) params.bucket = opts.bucket;
  return request('/_sim/history/pnl-all', { method: 'GET', params });
}

export type UserProfileExt = {
  name: string;
  email: string;
  phone: string;
  country: string;
  riskProfile: string;
  maxCapitalPerStrategy: number;
  notificationsEmail: boolean;
  notificationsSMS: boolean;
  theme: string;
};
export function getUserProfileExt(): Promise<UserProfileExt> {
  return request('/_sim/profile', { method: 'GET' });
}
export function saveUserProfileExt(patch: Partial<UserProfileExt>): Promise<{ ok: boolean; profile: UserProfileExt }> {
  return request('/_sim/profile', { method: 'POST', data: patch });
}

export type VolRegime = 'calm' | 'normal' | 'elevated' | 'high';
export type TrendDir = 'up' | 'down' | 'sideways';
export type InstrumentRegime = {
  code: string;
  regime: VolRegime;
  trend: TrendDir;
  regimeLabel: string;
  trendLabel: string;
  realizedVolPct: number;
  baselineVolPct: number;
  volRatio: number;
  sampleSize: number;
  lastPrice?: number;
  firstPrice?: number;
};
export type MarketStatus = {
  instruments: InstrumentRegime[];
  overall: { regime: VolRegime; regimeLabel: string; summary: string };
  overallTrend: TrendDir;
  fitByCode: Record<string, { fits: boolean; regime: VolRegime; trend: TrendDir }>;
  updatedAt: string;
};
export function marketStatus(): Promise<MarketStatus> {
  return request('/_sim/market-status', { method: 'GET' });
}
