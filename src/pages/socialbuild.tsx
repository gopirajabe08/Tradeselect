import React, { useEffect, useState } from 'react';
import { Card, Spin, Alert, Typography } from 'antd';
import { getSocialBuildStrategyTweak } from '@/services/api';

const { Title } = Typography;

export default function Page() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try { const d = await getSocialBuildStrategyTweak(); if (mounted) setData(d as Record<string, unknown>); }
      catch (e) { if (mounted) setErr(e instanceof Error ? e.message : String(e)); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <Card>
      <Title level={3} style={{ margin: 0, marginBottom: 16, color: '#213654' }}>Social Build</Title>
      {loading && <Spin />}
      {err && <Alert type="error" message={err} showIcon />}
      {data && (
        <pre style={{ margin: 0, fontSize: 12, maxHeight: 600, overflow: 'auto', background: '#fafafa', padding: 16, borderRadius: 4 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </Card>
  );
}
