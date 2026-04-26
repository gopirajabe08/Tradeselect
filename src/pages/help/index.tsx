import React from 'react';
import { Card, Row, Col, Input, Typography, List } from 'antd';
import { SearchOutlined, QuestionCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const TOPICS = [
  { title: 'Getting Started', items: ['What is TradeSelect?', 'Creating your first strategy', 'Connecting a broker'] },
  { title: 'Strategies', items: ['Saved strategies', 'Backtesting basics', 'Execution parameters'] },
  { title: 'Billing', items: ['Plans & pricing', 'Pay-as-you-go', 'Refunds'] },
  { title: 'Broking', items: ['Supported brokers', 'Broker credentials', 'Order modes'] },
];

export default function Help() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <Title level={3} style={{ margin: 0 }}>Help Center</Title>
        <Text type="secondary">Search for answers, browse by topic, or contact support.</Text>
        <div style={{ marginTop: 16 }}>
          <Input size="large" placeholder="Search help articles" prefix={<SearchOutlined />} />
        </div>
      </Card>
      <Row gutter={[16, 16]}>
        {TOPICS.map((t) => (
          <Col key={t.title} xs={24} md={12} lg={6}>
            <Card title={<><QuestionCircleOutlined /> {t.title}</>} size="small">
              <List
                size="small"
                dataSource={t.items}
                renderItem={(s) => <List.Item><a>{s}</a></List.Item>}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
