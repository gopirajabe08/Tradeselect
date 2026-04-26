import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Table, Tag, Tooltip, Typography, Spin, Alert, Progress } from 'antd';
import * as Icons from '@ant-design/icons';
import {
  getDashboardAccountInfo,
  getDashboardPortfolioData,
  getDashboardProgression,
  getDashboardSubscriptionInfo,
} from '@/services/api';
import { PnlChart, PriceGrid } from '@/components/Charts';
import { MarketStatusBanner } from '@/components/Market';

const { Text } = Typography;

type StatCard = { title: string; value: number | string; icon: string; tooltip: string };
type AccountInfo = { data: StatCard[] };

function RenderIcon({ name, size = 22, color = '#1677ff' }: { name: string; size?: number; color?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ style?: React.CSSProperties }>>)[name];
  if (!Cmp) return <Icons.AppstoreFilled style={{ fontSize: size, color }} />;
  return <Cmp style={{ fontSize: size, color }} />;
}

function StatCards({ data }: { data: StatCard[] }) {
  return (
    <Row gutter={[16, 16]}>
      {data.map((s, i) => (
        <Col key={i} xs={24} sm={12} md={8} lg={Math.floor(24 / Math.min(data.length, 6))}>
          <Card size="small" bodyStyle={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 44, height: 44, borderRadius: 8,
                  background: '#f0f7ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <RenderIcon name={s.icon} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Tooltip title={s.tooltip}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{s.title}</Text>
                </Tooltip>
                <div style={{ fontSize: 22, fontWeight: 600, color: '#213654', lineHeight: 1.2 }}>
                  {s.value}
                </div>
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

type PortfolioRow = {
  key: number;
  mode?: { modeIcon?: string };
  strategy?: { name?: string; code?: string; strategyType?: string };
  instruments?: { name?: string; code?: string };
  tag?: string;
  pnl?: { currency?: string; amount?: number; volumeOfTrades?: number };
  progress?: { lastEvent?: { timestamp?: string; text?: string; color?: string }; notStartedYet?: boolean };
  status?: number;
};

function formatCurrency(c?: string, n?: number): string {
  if (n == null) return '—';
  return `${c ?? '₹'}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const portfolioColumns = [
  {
    title: 'Mode', dataIndex: 'mode', key: 'mode', width: 80,
    render: (m?: PortfolioRow['mode']) => <Tag color="blue" style={{ margin: 0 }}>{(m?.modeIcon || 'mode').replace('customIcon', '')}</Tag>,
  },
  {
    title: 'Strategy', dataIndex: 'strategy', key: 'strategy', width: 220,
    render: (s?: PortfolioRow['strategy']) => (
      <div>
        <div style={{ fontWeight: 600, color: '#213654' }}>{s?.name ?? '—'}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{s?.code} · {s?.strategyType}</Text>
      </div>
    ),
  },
  {
    title: 'Instrument', dataIndex: 'instruments', key: 'instruments', width: 140,
    render: (i?: PortfolioRow['instruments']) => (<div><div style={{ fontWeight: 500 }}>{i?.code ?? '—'}</div><Text type="secondary" style={{ fontSize: 12 }}>{i?.name}</Text></div>),
  },
  {
    title: 'P&L', dataIndex: 'pnl', key: 'pnl', width: 120,
    render: (p?: PortfolioRow['pnl']) => {
      const amt = p?.amount ?? 0;
      const color = amt > 0 ? '#3f8600' : amt < 0 ? '#cf1322' : '#8c8c8c';
      return <div style={{ color, fontWeight: 600 }}>{formatCurrency(p?.currency, amt)}</div>;
    },
  },
  {
    title: 'Status', dataIndex: 'progress', key: 'progress',
    render: (p?: PortfolioRow['progress']) => (p?.lastEvent?.text ? <Tag>{p.lastEvent.text}</Tag> : <Text type="secondary">—</Text>),
  },
];

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [subscription, setSubscription] = useState<Record<string, unknown> | null>(null);
  const [progression, setProgression] = useState<Record<string, unknown> | null>(null);
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[]>([]);
  const [portfolioTotal, setPortfolioTotal] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function pull() {
      const results = await Promise.allSettled([
        getDashboardAccountInfo(),
        getDashboardSubscriptionInfo(),
        getDashboardProgression(),
        getDashboardPortfolioData(),
      ]);
      if (!mounted) return;
      const [acct, sub, prog, portfolio] = results;
      if (acct.status === 'fulfilled') setAccountInfo(acct.value as AccountInfo);
      if (sub.status === 'fulfilled') setSubscription(sub.value);
      if (prog.status === 'fulfilled') setProgression(prog.value);
      if (portfolio.status === 'fulfilled') {
        setPortfolioRows((portfolio.value.data as PortfolioRow[]) ?? []);
        setPortfolioTotal(portfolio.value.total ?? 0);
      }
      setLoading(false);
    }
    pull();
    const timer = setInterval(pull, 4000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <MarketStatusBanner />

      {accountInfo?.data && <StatCards data={accountInfo.data} />}

      <Card title="Live Market" size="small">
        <PriceGrid cols={3} />
      </Card>

      <Card title="Portfolio P&L (active positions)" size="small">
        <PnlChart height={220} pollMs={3000} />
      </Card>

      {progression && Array.isArray((progression as { data?: unknown[] }).data) && (
        <Card title="Progression" size="small">
          <Row gutter={[16, 16]}>
            {((progression as { data: Array<{ title: string; value?: number; max?: number; color?: string; description?: string }> }).data).map((p, i) => (
              <Col key={i} xs={24} sm={12} md={8}>
                <div>
                  <Tooltip title={p.description}><Text strong>{p.title}</Text></Tooltip>
                  <Progress
                    percent={p.max ? Math.round(((p.value ?? 0) / p.max) * 100) : (p.value ?? 0)}
                    strokeColor={p.color || '#1677ff'}
                    format={() => `${p.value ?? 0}${p.max ? ` / ${p.max}` : ''}`}
                  />
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <Card title={`My Portfolio (${portfolioTotal} strategies)`} size="small" bodyStyle={{ padding: 0 }}>
        <Table columns={portfolioColumns} dataSource={portfolioRows} rowKey="key" pagination={false} size="middle" scroll={{ x: 900 }} />
      </Card>
    </div>
  );
}
