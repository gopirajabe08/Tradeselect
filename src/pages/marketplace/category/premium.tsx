import React, { useState } from 'react';
import { Button, message } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { LiveApiTable } from '@/components/ApiTable/LiveApiTable';
import { StartStrategyModal, type StartStrategyInput } from '@/components/StartStrategyModal';
import { getStrategyColumns, getStrategy } from '@/services/api';

export default function MarketplacePremium() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<StartStrategyInput | null>(null);

  const customRender = {
    executeButton: (row: Record<string, unknown>) => {
      const td = (row.titleDescription as Record<string, unknown>) ?? {};
      const title = String(td.title ?? row.key ?? 'Strategy');
      return (
        <Button
          type="primary"
          size="small"
          icon={<PlayCircleOutlined />}
          onClick={() => {
            setSelected({
              strategyCode: String(row.key ?? 'UNKNOWN'),
              strategyName: title,
              strategyType: 'tradeauto',
            });
            setOpen(true);
          }}
        >
          Execute
        </Button>
      );
    },
  };

  return (
    <>
      <LiveApiTable
        title="Premium Strategies"
        fetchColumns={getStrategyColumns}
        fetchData={(p) => getStrategy({ ...p, category: 'premium' })}
        customRender={customRender}
        pollMs={10000}
      />
      <StartStrategyModal
        open={open}
        onClose={() => setOpen(false)}
        onStarted={() => message.info('Running — open Portfolio to see live progress')}
        strategy={selected}
      />
    </>
  );
}
