import React, { useEffect, useState } from 'react';
import { Button, Space, Tag, Tooltip, message } from 'antd';
import { PlayCircleOutlined, CheckCircleFilled } from '@ant-design/icons';
import { LiveApiTable } from '@/components/ApiTable/LiveApiTable';
import { StartStrategyModal, type StartStrategyInput } from '@/components/StartStrategyModal';
import { MarketStatusBanner } from '@/components/Market';
import { getStrategyColumns, getStrategy } from '@/services/api';
import { marketStatus, type MarketStatus } from '@/services/trading';

export default function Marketplace() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<StartStrategyInput | null>(null);
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    async function pull() {
      try {
        const s = await marketStatus();
        if (mounted) setStatus(s);
      } catch { /* best-effort */ }
    }
    pull();
    const timer = setInterval(pull, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const customRender = {
    executeButton: (row: Record<string, unknown>) => {
      const td = (row.titleDescription as Record<string, unknown>) ?? {};
      const title = String(td.title ?? row.key ?? 'Strategy');
      const code = String(row.key ?? 'UNKNOWN');
      const conditions = (row.marketConditions as string[] | undefined) ?? [];
      const fit = status?.fitByCode?.[code];
      return (
        <Space direction="vertical" size={4} align="end">
          <Space size={4} wrap style={{ justifyContent: 'flex-end' }}>
            {conditions.slice(0, 2).map((c) => (
              <Tag key={c} color="default" style={{ margin: 0, fontSize: 10, padding: '0 6px' }}>{c}</Tag>
            ))}
            {fit?.fits && (
              <Tooltip title={`Current ${fit.regime} volatility · ${fit.trend} — this strategy style tends to work in these conditions`}>
                <Tag color="green" icon={<CheckCircleFilled />} style={{ margin: 0, fontSize: 10, padding: '0 6px' }}>
                  Good fit now
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => {
              setSelected({
                strategyCode: code,
                strategyName: title,
                strategyType: 'tradeauto',
              });
              setOpen(true);
            }}
          >
            Execute
          </Button>
        </Space>
      );
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MarketStatusBanner />
      <LiveApiTable
        title="Strategy Marketplace"
        fetchColumns={getStrategyColumns}
        fetchData={(p) => getStrategy(p)}
        customRender={customRender}
        pollMs={10000}
      />
      <StartStrategyModal
        open={open}
        onClose={() => setOpen(false)}
        onStarted={() => message.info('Running — open Portfolio to see live progress')}
        strategy={selected}
      />
    </div>
  );
}
