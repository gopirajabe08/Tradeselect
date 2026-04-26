import React from 'react';
import { Card, Result } from 'antd';

export default function Checkout() {
  return (
    <Card>
      <Result
        status="info"
        title="Checkout"
        subTitle="Payment flow — wire this to your real payment gateway (Razorpay / Stripe)."
      />
    </Card>
  );
}
