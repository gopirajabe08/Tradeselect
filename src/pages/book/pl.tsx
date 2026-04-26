import React from 'react';
import { Card } from 'antd';
import { LiveApiTable } from '@/components/ApiTable/LiveApiTable';
import { getBookPLColumns, getBookPLData } from '@/services/api';
import { PnlChart } from '@/components/Charts';

export default function PLBook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Realized + total P&L" size="small">
        <PnlChart height={220} pollMs={3000} />
      </Card>
      <LiveApiTable
        title="P&L Book"
        fetchColumns={getBookPLColumns}
        fetchData={(p) => getBookPLData(p)}
      />
    </div>
  );
}
