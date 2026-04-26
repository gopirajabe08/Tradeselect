import React from 'react';
import { Card } from 'antd';
import { LiveApiTable } from '@/components/ApiTable/LiveApiTable';
import { getBookTradeColumns, getBookTradeData } from '@/services/api';
import { PnlChart } from '@/components/Charts';

export default function TradeBook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="P&L history (aggregate)" size="small">
        <PnlChart height={200} pollMs={3000} />
      </Card>
      <LiveApiTable
        title="Trade Book"
        fetchColumns={getBookTradeColumns}
        fetchData={(p) => getBookTradeData(p)}
      />
    </div>
  );
}
