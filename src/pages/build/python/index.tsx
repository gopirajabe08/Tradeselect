import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Spin, Tag, Typography, Button, Empty } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { getPythonBuildMeta } from '@/services/api';

const { Title, Text } = Typography;

type FilterValue = { label?: string; value?: string; count?: number };

function FilterBlock({ label, values }: { label: string; values: FilterValue[] }) {
  return (
    <Card size="small" title={label} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {values.map((v, i) => (
          <Tag key={i} color="blue" style={{ cursor: 'pointer' }}>
            {v.label ?? String(v.value ?? '—')}
            {typeof v.count === 'number' ? ` (${v.count})` : ''}
          </Tag>
        ))}
      </div>
    </Card>
  );
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try { const f = await getPythonBuildMeta(); if (mounted) setFilters(f); }
      catch { /* fall through */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return <Spin style={{ display: 'block', marginTop: 48 }} />;

  const buckets = filters && typeof filters === 'object' ? Object.entries(filters) : [];
  const filterBuckets = buckets.filter(([, v]) => Array.isArray(v));

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Title level={3} style={{ margin: 0, color: '#213654' }}>Python Build</Title>
            <Text type="secondary">Build in Python</Text>
          </Col>
          <Col>
            <Button type="primary" size="large" icon={<PlayCircleOutlined />}>Create Strategy</Button>
          </Col>
        </Row>
      </Card>

      {filterBuckets.length ? (
        <Row gutter={16}>
          {filterBuckets.map(([k, v]) => (
            <Col key={k} xs={24} md={12} lg={8}>
              <FilterBlock label={k} values={v as FilterValue[]} />
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description="No templates available yet — filter data not returned." />
      )}
    </div>
  );
}
