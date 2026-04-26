import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Select, InputNumber, Switch, Button, Spin, message, Row, Col, Typography, Divider } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { getUserProfileExt, saveUserProfileExt, type UserProfileExt } from '@/services/trading';

const { Title } = Typography;

const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Singapore', 'UAE'];
const RISK_PROFILES = ['Conservative', 'Moderate', 'Aggressive'];
const THEMES = ['light', 'dark'];

export default function Settings() {
  const [form] = Form.useForm<UserProfileExt>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getUserProfileExt()
      .then((p) => form.setFieldsValue(p))
      .finally(() => setLoading(false));
  }, [form]);

  const onSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await saveUserProfileExt(values);
      form.setFieldsValue(res.profile);
      message.success('Settings saved');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;

  return (
    <Card>
      <Title level={3} style={{ marginTop: 0, color: '#213654' }}>Settings</Title>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Divider orientation="left">Profile</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item label="Name" name="name" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="Phone" name="phone"><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="Country" name="country"><Select options={COUNTRIES.map((c) => ({ value: c, label: c }))} /></Form.Item></Col>
        </Row>
        <Divider orientation="left">Risk & Limits</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item label="Risk profile" name="riskProfile"><Select options={RISK_PROFILES.map((r) => ({ value: r, label: r }))} /></Form.Item></Col>
          <Col xs={24} md={12}>
            <Form.Item label="Max capital per strategy (₹)" name="maxCapitalPerStrategy">
              <InputNumber style={{ width: '100%' }} min={1000} step={10000} />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left">Notifications</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item label="Email alerts" name="notificationsEmail" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="SMS alerts" name="notificationsSMS" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="Theme" name="theme"><Select options={THEMES.map((t) => ({ value: t, label: t }))} /></Form.Item></Col>
        </Row>
        <Button type="primary" icon={<SaveOutlined />} onClick={onSubmit} loading={saving}>Save</Button>
      </Form>
    </Card>
  );
}
