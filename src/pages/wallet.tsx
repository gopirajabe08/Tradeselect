import React, { useEffect, useState } from 'react';
import { Card, Spin, Row, Col, Typography, Tabs } from 'antd';
import { ApiTable } from '@/components/ApiTable';
import {
  getWalletPricing,
  getWalletAlgoform,
  getWalletPayAsYouGoColumn,
  getWalletPayAsYouGoData,
} from '@/services/api';

const { Title, Text } = Typography;

export default function Wallet() {
  const [pricing, setPricing] = useState<Record<string, unknown> | null>(null);
  const [algoform, setAlgoform] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [p, a] = await Promise.allSettled([getWalletPricing(), getWalletAlgoform()]);
      if (!mounted) return;
      if (p.status === 'fulfilled') setPricing(p.value);
      if (a.status === 'fulfilled') setAlgoform(a.value);
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="Pricing" size="small">
            {!pricing ? <Spin /> : (
              <pre style={{ margin: 0, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(pricing, null, 2)}
              </pre>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Algo Form" size="small">
            {!algoform ? <Spin /> : (
              <pre style={{ margin: 0, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(algoform, null, 2)}
              </pre>
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Pay As You Go" size="small">
        <ApiTable
          fetchColumns={getWalletPayAsYouGoColumn}
          fetchData={(p) => getWalletPayAsYouGoData(p)}
        />
      </Card>
    </div>
  );
}
