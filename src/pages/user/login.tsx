import React, { useState } from 'react';
import { Link, history, useModel } from '@umijs/max';
import { Form, Input, Button, Tabs, Select, message } from 'antd';
import { login, DEMO_CREDENTIALS } from '@/services/auth';
import styles from './login.less';

const { Option } = Select;

type Region = 'in' | 'us' | 'row';

const regionCopy: Record<Region, { heading: string; countryCode: string; countryLabel: string }> = {
  in:  { heading: 'Login with your Mobile Number', countryCode: '+91', countryLabel: 'IN' },
  us:  { heading: 'Login with your Mobile Number', countryCode: '+1',  countryLabel: 'US' },
  row: { heading: 'Login with your Mobile Number', countryCode: '+44', countryLabel: 'UK' },
};

const GoogleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
  </svg>
);

export default function LoginPage() {
  const [form] = Form.useForm();
  const [region, setRegion] = useState<Region>('in');
  const [loading, setLoading] = useState(false);
  const copy = regionCopy[region];
  const { refresh } = useModel('@@initialState');

  const onFinish = async (values: { mobile: string; password: string }) => {
    setLoading(true);
    try {
      const user = await login({
        countryCode: copy.countryCode,
        mobile: values.mobile,
        password: values.password,
      });
      message.success(`Welcome, ${user.name}`);
      await refresh();
      history.push('/dashboard');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const demoForRegion = DEMO_CREDENTIALS.find((c) => c.countryCode === copy.countryCode);

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.loginCol}>
          <div className={styles.card}>
            <Tabs
              activeKey={region}
              onChange={(k) => setRegion(k as Region)}
              items={[
                { key: 'in',  label: 'India' },
                { key: 'us',  label: 'US' },
                { key: 'row', label: 'Rest of the World' },
              ]}
            />

            <h3 className={styles.heading}>{copy.heading}</h3>

            <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
              <Form.Item
                name="mobile"
                rules={[{ required: true, message: 'Please enter your mobile number' }]}
              >
                <Input
                  className={styles.fieldInput}
                  addonBefore={
                    <Select value={copy.countryLabel} style={{ width: 90 }} disabled>
                      <Option value={copy.countryLabel}>{`${copy.countryLabel} (${copy.countryCode})`}</Option>
                    </Select>
                  }
                  placeholder="Mobile Number"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[{ required: true, message: 'Please enter your password' }]}
              >
                <Input.Password className={styles.fieldInput} placeholder="Enter Your Password" />
              </Form.Item>

              <Form.Item>
                <Button htmlType="submit" className={styles.loginBtn} loading={loading}>
                  Login
                </Button>
              </Form.Item>
            </Form>

            <div className={styles.linksRow}>
              <a href="#login-otp">Login with OTP</a>
              <a href="#forgot">Forgot Password?</a>
            </div>

            <div className={styles.divider}>Or continue with</div>

            <div className={styles.socialRow}>
              <button type="button" className={styles.googleBtn} aria-label="Sign in with Google">
                <GoogleIcon />
              </button>
            </div>

            <div className={styles.signupRow}>
              New to TradeAuto?<Link to="/user/register">Sign Up</Link>
            </div>

            {demoForRegion && (
              <button
                type="button"
                className={styles.demoHint}
                onClick={() => {
                  form.setFieldsValue({
                    mobile: demoForRegion.mobile,
                    password: demoForRegion.password,
                  });
                }}
              >
                <div className={styles.demoTitle}>Demo account (click to fill)</div>
                <div className={styles.demoLine}>
                  <span>Mobile</span>
                  <code>{demoForRegion.countryCode} {demoForRegion.mobile}</code>
                </div>
                <div className={styles.demoLine}>
                  <span>Password</span>
                  <code>{demoForRegion.password}</code>
                </div>
              </button>
            )}
          </div>
        </div>

        <div className={styles.featureCol}>
          <div className={styles.logoRow}>
            <div className={styles.logoText}>TradeAuto</div>
          </div>
          <div className={styles.welcome}>TradeAuto</div>
          <div className={styles.unleash}>
            Unleash the potential of your investment in the capital market with novel algorithmic trading.
          </div>
          <div className={styles.bannerPlaceholder}>
            <div className={styles.quoteMark}>&ldquo;</div>
            <div className={styles.quoteText}>Pain + Reflection = Progress.</div>
            <div className={styles.quoteAuthor}>— Ray Dalio</div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <Link to="/documents/terms-conditions-of-use">Terms of Use</Link>
        <span className={styles.sep}>|</span>
        <Link to="/documents/privacy-policy">Privacy Policy</Link>
        <span className={styles.sep}>|</span>
        <Link to="/documents/disclaimer">Disclaimer</Link>
        <span className={styles.sep}>|</span>
        <Link to="/documents/refund-policy">Refund Policy</Link>
      </div>
    </div>
  );
}
