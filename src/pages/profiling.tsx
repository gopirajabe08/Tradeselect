import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Select, InputNumber, Switch, Button, Spin, message, Row, Col, Typography, Divider, Slider } from 'antd';
import { SaveOutlined, UserOutlined } from '@ant-design/icons';
import { getUserProfileExt, saveUserProfileExt, type UserProfileExt } from '@/services/trading';

const { Title, Text } = Typography;

export default function Profiling() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [risk, setRisk] = useState(5);

  useEffect(() => {
    getUserProfileExt()
      .then((p) => {
        form.setFieldsValue({
          ...p,
          riskTolerance: p.riskProfile === 'Conservative' ? 3 : p.riskProfile === 'Aggressive' ? 8 : 5,
          investmentHorizon: '1-3 years',
          monthlyInvestment: 50000,
          primaryGoal: 'Wealth Growth',
        });
      })
      .finally(() => setLoading(false));
  }, [form]);

  const onSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const riskProfile = values.riskTolerance >= 7 ? 'Aggressive' : values.riskTolerance <= 3 ? 'Conservative' : 'Moderate';
    try {
      const res = await saveUserProfileExt({ riskProfile } as Partial<UserProfileExt>);
      message.success(`Profile updated — Risk: ${res.profile.riskProfile}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;

  return (
    <Card>
      <Title level={3} style={{ marginTop: 0, color: '#213654' }}><UserOutlined /> Investor Profile</Title>
      <Text type="secondary">Help us tailor strategy suggestions to your risk appetite.</Text>
      <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
        <Divider orientation="left">Risk Assessment</Divider>
        <Form.Item label={`Risk tolerance (${risk}/10)`} name="riskTolerance">
          <Slider min={1} max={10} onChange={(v) => setRisk(v as number)} marks={{ 1: 'Low', 5: 'Medium', 10: 'High' }} />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="Investment horizon" name="investmentHorizon">
              <Select options={['< 1 year', '1-3 years', '3-5 years', '5+ years'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="Primary goal" name="primaryGoal">
              <Select options={['Wealth Growth', 'Income', 'Preservation', 'Speculation'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="Monthly investment (₹)" name="monthlyInvestment">
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="Max capital per strategy (₹)" name="maxCapitalPerStrategy">
              <InputNumber style={{ width: '100%' }} min={1000} step={10000} />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" icon={<SaveOutlined />} onClick={onSubmit} loading={saving}>Save Profile</Button>
      </Form>
    </Card>
  );
}
