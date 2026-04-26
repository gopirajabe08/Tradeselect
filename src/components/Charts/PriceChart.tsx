import React, { useEffect, useState } from 'react';
import { Line } from '@ant-design/charts';
import { Empty, Spin } from 'antd';
import { priceHistory } from '@/services/trading';

export function PriceChart({ instrument, pollMs = 3000, height = 260 }: { instrument: string; pollMs?: number; height?: number }) {
  const [data, setData] = useState<Array<{ t: number; price: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function pull() {
      try {
        const res = await priceHistory(instrument);
        if (!mounted) return;
        setData(res.data ?? []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    pull();
    const timer = setInterval(pull, pollMs);
    return () => { mounted = false; clearInterval(timer); };
  }, [instrument, pollMs]);

  if (loading && !data.length) return <Spin style={{ display: 'block', margin: '32px auto' }} />;
  if (!data.length) return <Empty description="No price history yet" />;

  return (
    <Line
      data={data}
      xField="t"
      yField="price"
      height={height}
      smooth
      xAxis={{ title: { text: 'tick' } }}
      yAxis={{ title: { text: `${instrument} price` } }}
      color="#1677ff"
      lineStyle={{ lineWidth: 2 }}
      point={{ size: 0 }}
      tooltip={{ formatter: (d: any) => ({ name: instrument, value: `₹${d.price}` }) }}
    />
  );
}
