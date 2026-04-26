import React, { useState } from 'react';
import { Link, history } from '@umijs/max';
import { Form, Input, Button, Tabs, Typography, message } from 'antd';
import styles from './login.less';

const { Title } = Typography;
type Region = 'in' | 'us' | 'row';

export default function Register() {
  const [region, setRegion] = useState<Region>('in');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    message.success('Account created (mock). Please login.');
    setLoading(false);
    history.push('/user/login');
  };

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.loginCol}>
          <div className={styles.card}>
            <Tabs
              activeKey={region}
              onChange={(k) => setRegion(k as Region)}
              items={[
                { key: 'in', label: 'India' },
                { key: 'us', label: 'US' },
                { key: 'row', label: 'Rest of the World' },
              ]}
            />
            <h3 className={styles.heading}>Create your TradeAuto account</h3>
            <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
              <Form.Item name="name" rules={[{ required: true, message: 'Full name required' }]}>
                <Input className={styles.fieldInput} placeholder="Full Name" />
              </Form.Item>
              <Form.Item name="mobile" rules={[{ required: true, message: 'Mobile required' }]}>
                <Input className={styles.fieldInput} placeholder="Mobile Number" />
              </Form.Item>
              <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
                <Input className={styles.fieldInput} placeholder="Email" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, min: 6 }]}>
                <Input.Password className={styles.fieldInput} placeholder="Password (min 6 chars)" />
              </Form.Item>
              <Form.Item>
                <Button htmlType="submit" className={styles.loginBtn} loading={loading}>Sign Up</Button>
              </Form.Item>
            </Form>
            <div className={styles.signupRow}>
              Already have an account?<Link to="/user/login">Login</Link>
            </div>
          </div>
        </div>
        <div className={styles.featureCol}>
          <div className={styles.logoRow}><div className={styles.logoText}>TradeAuto</div></div>
          <Title level={2} style={{ margin: '8px 0', color: '#213654' }}>Join TradeAuto</Title>
          <div className={styles.unleash}>
            Start automating your trades with algorithmic precision. Join today.
          </div>
        </div>
      </div>
    </div>
  );
}
