import React, { useEffect, useState } from 'react';
import { Alert, Space, Tag, Tooltip, Typography } from 'antd';
import {
  RiseOutlined,
  FallOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { marketStatus, type MarketStatus, type VolRegime, type TrendDir } from '@/services/trading';

const { Text } = Typography;

// Tag color per regime so the banner reads at a glance.
const REGIME_COLOR: Record<VolRegime, string> = {
  calm: 'blue',
  normal: 'green',
  elevated: 'orange',
  high: 'red',
};

// Alert type per overall regime — green for calm/normal, amber for elevated,
// red (error) for high so the user can see "danger" without reading text.
function regimeAlertType(r: VolRegime): 'info' | 'success' | 'warning' | 'error' {
  if (r === 'calm') return 'info';
  if (r === 'normal') return 'success';
  if (r === 'elevated') return 'warning';
  return 'error';
}

function TrendIcon({ trend }: { trend: TrendDir }) {
  if (trend === 'up')   return <RiseOutlined style={{ color: '#3f8600' }} />;
  if (trend === 'down') return <FallOutlined style={{ color: '#cf1322' }} />;
  return <SwapOutlined style={{ color: '#8c8c8c' }} />;
}

export function MarketStatusBanner({ pollMs = 5000 }: { pollMs?: number }) {
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    async function pull() {
      try {
        const s = await marketStatus();
        if (mounted) setStatus(s);
      } catch { /* swallow — banner is best-effort */ }
    }
    pull();
    const timer = setInterval(pull, pollMs);
    return () => { mounted = false; clearInterval(timer); };
  }, [pollMs]);

  if (!status) return null;

  const overall = status.overall;
  const indexList = status.instruments.filter((i) => i.code === 'NIFTY' || i.code === 'BANKNIFTY');

  return (
    <Alert
      type={regimeAlertType(overall.regime)}
      showIcon
      icon={<ThunderboltOutlined />}
      message={
        <Space wrap size={[12, 4]}>
          <Text strong>Current Market:</Text>
          <Tag color={REGIME_COLOR[overall.regime]} style={{ margin: 0 }}>
            {overall.regimeLabel}
          </Tag>
          {indexList.map((i) => (
            <Tooltip
              key={i.code}
              title={`Realized vol ${i.realizedVolPct.toFixed(2)}% vs baseline ${i.baselineVolPct.toFixed(2)}% · sampled over last ${i.sampleSize} ticks`}
            >
              <Space size={4}>
                <Text style={{ fontSize: 12 }}>{i.code}</Text>
                <Tag color={REGIME_COLOR[i.regime]} style={{ margin: 0, fontSize: 11 }}>
                  {i.regimeLabel}
                </Tag>
                <TrendIcon trend={i.trend} />
                <Text type="secondary" style={{ fontSize: 11 }}>{i.trendLabel}</Text>
              </Space>
            </Tooltip>
          ))}
        </Space>
      }
      description={
        <Text type="secondary" style={{ fontSize: 12 }}>
          {overall.regime === 'calm'
            ? 'Low volatility — mean-reversion strategies tend to work best right now.'
            : overall.regime === 'normal'
              ? 'Normal conditions — trend-following strategies are a good fit.'
              : overall.regime === 'elevated'
                ? 'Volatility is picking up — breakout strategies may capture moves; size down if unsure.'
                : 'High volatility — breakouts can spike; avoid mean-reversion, use tight stops.'}
        </Text>
      }
      style={{ marginBottom: 0 }}
    />
  );
}
