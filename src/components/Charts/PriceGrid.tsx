import React, { useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Statistic, Tag, Tooltip, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { listInstruments, priceHistory, type DataSource, type Instrument } from '@/services/trading';
import { PriceChart } from './PriceChart';

const { Text } = Typography;

const SOURCE_META: Record<DataSource, { label: string; color: string; tooltip: string }> = {
  live:               { label: 'LIVE',     color: 'green',  tooltip: 'Market open — real-time quote from Yahoo Finance (delayed ~15s on free tier)' },
  delayed:            { label: 'DELAYED',  color: 'gold',   tooltip: 'Last trade from Yahoo Finance (market closed or delayed feed)' },
  'cached-baseline':  { label: 'BASELINE', color: 'default',tooltip: 'Yahoo rate-limited — using recent observed price. Will upgrade to DELAYED once feed recovers.' },
  'gbm-fallback':     { label: 'SIM',      color: 'red',    tooltip: 'Simulated (GBM). Yahoo Finance not reachable for this instrument.' },
};

function SourceBadge({ source }: { source?: DataSource }) {
  if (!source) return null;
  const m = SOURCE_META[source];
  return (
    <Tooltip title={m.tooltip}>
      <Tag color={m.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 6px' }}>
        {m.label}
      </Tag>
    </Tooltip>
  );
}

export function PriceGrid({ cols = 3, pollMs = 3000 }: { cols?: number; pollMs?: number }) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [opens, setOpens] = useState<Record<string, number>>({});
  // Ref mirrors `opens` so the pull() closure reads the current value, not
  // the stale value captured when the effect was set up. Without this,
  // priceHistory was re-fetched for every instrument on every poll.
  const opensRef = useRef<Record<string, number>>({});
  opensRef.current = opens;

  useEffect(() => {
    let mounted = true;
    async function pull() {
      const list = await listInstruments().catch(() => []);
      if (!mounted) return;
      setInstruments(list);
      for (const i of list) {
        if (opensRef.current[i.code] == null) {
          priceHistory(i.code).then((r) => {
            const first = r.data[0]?.price;
            if (first != null && mounted) {
              setOpens((o) => ({ ...o, [i.code]: first }));
            }
          }).catch(() => void 0);
        }
      }
    }
    pull();
    const timer = setInterval(pull, pollMs);
    return () => { mounted = false; clearInterval(timer); };
  }, [pollMs]);

  return (
    <Row gutter={[16, 16]}>
      {instruments.map((i) => {
        const open = opens[i.code] ?? i.currentPrice;
        const delta = i.currentPrice - open;
        const deltaPct = open > 0 ? (delta / open) * 100 : 0;
        const up = delta >= 0;
        return (
          <Col key={i.code} xs={24} sm={12} lg={Math.floor(24 / cols)}>
            <Card size="small">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{i.code}</Text>
                <SourceBadge source={i.dataSource} />
              </div>
              <Statistic
                value={i.currentPrice}
                precision={2}
                prefix="₹"
                valueStyle={{ color: up ? '#3f8600' : '#cf1322', fontSize: 20 }}
                suffix={up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {i.exchange} · {delta >= 0 ? '+' : ''}{delta.toFixed(2)} ({deltaPct.toFixed(2)}%) from open
              </Text>
              <div style={{ marginTop: 8 }}>
                <PriceChart instrument={i.code} pollMs={pollMs} height={120} />
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
