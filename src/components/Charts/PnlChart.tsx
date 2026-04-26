import React, { useEffect, useState } from 'react';
import { Area, Column } from '@ant-design/charts';
import { Empty, Segmented, Space, Spin, Typography } from 'antd';
import { pnlHistory, pnlHistoryAll, type PnlPoint } from '@/services/trading';

const { Text } = Typography;

type Row = { t: string; pnl: number; kind: 'realized' | 'total' };

function formatHourLabel(iso: unknown): string {
  if (typeof iso !== 'string') return String(iso ?? '');
  // iso like '2026-04-24T14:00' -> '24 Apr 14:00'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthName = months[parseInt(m[2], 10) - 1] ?? m[2];
  return `${m[3]} ${monthName} ${m[4]}:${m[5]}`;
}

export function PnlChart({
  instanceId,
  pollMs = 3000,
  height = 260,
  onlyRunning = true,
  defaultView = 'hourly',
}: {
  instanceId?: number;
  pollMs?: number;
  height?: number;
  onlyRunning?: boolean;
  defaultView?: 'live' | 'hourly';
}) {
  const [data, setData] = useState<Row[]>([]);
  const [hourlyData, setHourlyData] = useState<Array<{ t: string; pnl: number; type: 'realized' | 'total' }>>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'live' | 'hourly'>(defaultView);

  useEffect(() => {
    let mounted = true;
    // reqGen increments on each pull(); only the newest-fire's result is
    // allowed to write to state. This prevents a slow in-flight pull from a
    // previous view/param-set overwriting fresh data after the user toggles.
    let reqGen = 0;
    async function pull() {
      const myReq = ++reqGen;
      const isStale = () => !mounted || myReq !== reqGen;
      try {
        if (view === 'hourly') {
          // Aggregated hourly buckets — running only by default.
          if (instanceId != null) {
            const res = await pnlHistory(instanceId);
            const byHour = new Map<string, PnlPoint>();
            for (const p of res.data) {
              const k = p.t.slice(0, 13) + ':00';
              byHour.set(k, p); // last value in each hour
            }
            const rows = Array.from(byHour.entries()).flatMap(([t, p]) => [
              { t, pnl: p.realized, type: 'realized' as const },
              { t, pnl: p.total,    type: 'total'    as const },
            ]);
            if (!isStale()) setHourlyData(rows);
          } else {
            const res = await pnlHistoryAll({ onlyRunning, bucket: 'hour' });
            const agg: Record<string, { realized: number; total: number }> = {};
            for (const arr of Object.values(res.series)) {
              for (const p of arr) {
                agg[p.t] = agg[p.t] ?? { realized: 0, total: 0 };
                agg[p.t].realized += p.realized;
                agg[p.t].total    += p.total;
              }
            }
            const rows = Object.entries(agg)
              .sort(([a], [b]) => a.localeCompare(b))
              .flatMap(([t, v]) => [
                { t, pnl: v.realized, type: 'realized' as const },
                { t, pnl: v.total,    type: 'total'    as const },
              ]);
            if (!isStale()) setHourlyData(rows);
          }
        } else {
          // Live per-tick timeline.
          let points: PnlPoint[] = [];
          if (instanceId != null) {
            const res = await pnlHistory(instanceId);
            points = res.data;
          } else {
            const res = await pnlHistoryAll({ onlyRunning });
            const agg: Record<string, { realized: number; total: number }> = {};
            for (const arr of Object.values(res.series)) {
              for (const p of arr) {
                agg[p.t] = agg[p.t] ?? { realized: 0, total: 0 };
                agg[p.t].realized += p.realized;
                agg[p.t].total    += p.total;
              }
            }
            points = Object.entries(agg).map(([t, v]) => ({
              t, price: 0, realized: v.realized, unrealized: v.total - v.realized, total: v.total,
            }));
          }
          const rows: Row[] = [];
          for (const p of points) {
            rows.push({ t: p.t, pnl: p.realized, kind: 'realized' });
            rows.push({ t: p.t, pnl: p.total,    kind: 'total' });
          }
          if (!isStale()) setData(rows);
        }
      } finally {
        if (!isStale()) setLoading(false);
      }
    }
    pull();
    const timer = setInterval(pull, pollMs);
    return () => { mounted = false; clearInterval(timer); };
  }, [instanceId, pollMs, onlyRunning, view]);

  const toggle = (
    <Space size={8} style={{ marginBottom: 12 }}>
      <Segmented
        size="small"
        value={view}
        onChange={(v) => setView(v as 'live' | 'hourly')}
        options={[
          { label: 'Hourly', value: 'hourly' },
          { label: 'Live', value: 'live' },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 11 }}>
        {onlyRunning ? 'Showing active (running) positions only' : 'Showing all positions'}
      </Text>
    </Space>
  );

  if (loading && !data.length && !hourlyData.length) {
    return <><>{toggle}</><Spin style={{ display: 'block', margin: '32px auto' }} /></>;
  }

  if (view === 'hourly') {
    if (!hourlyData.length) {
      return <><>{toggle}</><Empty description={onlyRunning ? 'No active strategies — start one to see hourly P&L' : 'No P&L yet'} /></>;
    }
    return (
      <>
        {toggle}
        <Column
          data={hourlyData}
          xField="t"
          yField="pnl"
          seriesField="type"
          isGroup
          height={height}
          color={['#52c41a', '#1677ff']}
          label={{ position: 'top', style: { fontSize: 10 }, formatter: (d: any) => d?.pnl ? `₹${Number(d.pnl).toFixed(0)}` : '' }}
          xAxis={{ label: { formatter: formatHourLabel, style: { fontSize: 10 } } }}
          yAxis={{ title: { text: 'P&L (₹)' } }}
          tooltip={{
            title: (t: unknown) => formatHourLabel(t),
            formatter: (d: any) => ({ name: d?.type ?? '', value: `₹${Number(d?.pnl ?? 0).toFixed(2)}` }),
          }}
          columnStyle={{ radius: [3, 3, 0, 0] }}
        />
      </>
    );
  }

  if (!data.length) {
    return <><>{toggle}</><Empty description={onlyRunning ? 'No active strategies — start one to see live P&L' : 'No P&L yet'} /></>;
  }
  return (
    <>
      {toggle}
      <Area
        data={data}
        xField="t"
        yField="pnl"
        seriesField="kind"
        height={height}
        smooth
        color={['#3f8600', '#1677ff']}
        line={{ size: 2 }}
        tooltip={{ formatter: (d: any) => ({ name: d.kind, value: `₹${Number(d.pnl).toFixed(2)}` }) }}
      />
    </>
  );
}
