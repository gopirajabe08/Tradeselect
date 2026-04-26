import React, { useState } from 'react';
import { Button, Space, Tag, message, Popconfirm, Card, Col, Row } from 'antd';
import { PlayCircleOutlined, StopOutlined, DeleteOutlined } from '@ant-design/icons';
import { LiveApiTable } from '@/components/ApiTable/LiveApiTable';
import { StartStrategyModal, type StartStrategyInput } from '@/components/StartStrategyModal';
import { getPortfolioColumns, getPortfolioStrategies } from '@/services/api';
import { stopStrategy, deleteInstance } from '@/services/trading';
import { PnlChart, PriceGrid } from '@/components/Charts';

export default function Portfolio() {
  const [open, setOpen] = useState(false);
  const [refreshTok, setRefreshTok] = useState(0);
  const [strategyForModal] = useState<StartStrategyInput>({
    strategyCode: 'MANUAL',
    strategyName: 'Manual Run',
    strategyType: 'odyssey',
  });

  const handleStop = async (row: Record<string, unknown>) => {
    const id = Number(row.key);
    try { await stopStrategy(id); message.success(`Stopped instance #${id}`); setRefreshTok((t) => t + 1); }
    catch (e) { message.error(e instanceof Error ? e.message : String(e)); }
  };

  const handleDelete = async (row: Record<string, unknown>) => {
    const id = Number(row.key);
    try { await deleteInstance(id); message.success(`Deleted instance #${id}`); setRefreshTok((t) => t + 1); }
    catch (e) { message.error(e instanceof Error ? e.message : String(e)); }
  };

  const customRender = {
    actionStartButton: (row: Record<string, unknown>) => {
      const isRunning = row.status === 1;
      if (isRunning) {
        return (
          <Popconfirm title="Stop this strategy?" onConfirm={() => handleStop(row)}>
            <Button danger size="small" icon={<StopOutlined />}>Stop</Button>
          </Popconfirm>
        );
      }
      return (
        <Space>
          <Tag color="default">Stopped</Tag>
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(row)}>
            <Button danger size="small" type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      );
    },
  };

  const headerExtra = (
    <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setOpen(true)}>
      Start New Strategy
    </Button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Aggregate P&L (active positions)" size="small">
        <PnlChart height={240} pollMs={3000} />
      </Card>
      <Card title="Live Market Prices" size="small">
        <PriceGrid cols={3} />
      </Card>
      <LiveApiTable
        key={refreshTok}
        title="My Portfolio"
        fetchColumns={getPortfolioColumns}
        fetchData={(p) => getPortfolioStrategies(p)}
        customRender={customRender}
        headerExtra={headerExtra}
      />
      <StartStrategyModal open={open} onClose={() => setOpen(false)} onStarted={() => setRefreshTok((t) => t + 1)} strategy={strategyForModal} />
    </div>
  );
}
