import React from 'react';
import { Link } from '@umijs/max';
import { Card, Button, Typography, Space } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import styles from './login.less';

const { Title, Text } = Typography;

const BROKERS = [
  { name: 'Zerodha', code: 'zerodha' },
  { name: 'Upstox', code: 'upstox' },
  { name: 'Angel One', code: 'angel' },
  { name: 'ICICI Direct', code: 'icici' },
  { name: '5paisa', code: '5paisa' },
  { name: 'Fyers', code: 'fyers' },
];

export default function BrokerLogin() {
  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.loginCol}>
          <div className={styles.card} style={{ width: 'min(34rem, 100%)' }}>
            <Title level={3}>Connect your broker</Title>
            <Text type="secondary">Choose a broker to authorize order execution from TradeSelect.</Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 24 }}>
              {BROKERS.map((b) => (
                <Button key={b.code} icon={<ApiOutlined />} size="large" style={{ textAlign: 'left' }}>
                  {b.name}
                </Button>
              ))}
            </div>
            <div className={styles.signupRow} style={{ marginTop: 24 }}>
              <Link to="/user/login">← Back to login</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
