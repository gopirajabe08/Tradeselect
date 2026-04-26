import React from 'react';
import { Button, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';

const { Text } = Typography;

type Any = Record<string, unknown>;

function fmtNum(n: unknown, maxFrac = 2): string {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: maxFrac });
}

function fmtCurrency(c: string | undefined, n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${c ?? '₹'}${fmtNum(n)}`;
}

function pnlColor(n: number | undefined): string {
  if (n == null) return '#8c8c8c';
  if (n > 0) return '#3f8600';
  if (n < 0) return '#cf1322';
  return '#8c8c8c';
}

// ---------- Renderer registry ----------

export type CellRenderer = (value: Any | undefined, row: Any, columnMeta: Any) => React.ReactNode;

export const renderers: Record<string, CellRenderer> = {
  strategy: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    // When used for Mode column (modeIcon lives on mode data), render small tag.
    if (v.modeIcon) {
      return <Tag color="blue">{String(v.modeIcon).replace('customIcon', '')}</Tag>;
    }
    // When used for Strategy column
    return (
      <div>
        <div style={{ fontWeight: 600, color: '#213654' }}>{String(v.name ?? v.title ?? '—')}</div>
        {(v.code || v.strategyType) && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {[v.code, v.strategyType].filter(Boolean).join(' · ')}
          </Text>
        )}
      </div>
    );
  },

  odysseyStrategy: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    return (
      <Space align="start">
        <div style={{
          width: 36, height: 36, borderRadius: 6, background: '#f0f7ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#1677ff', fontWeight: 700,
        }}>
          {String(v.name ?? 'S').slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>{String(v.name ?? '—')}</div>
          {v.code && <Text type="secondary" style={{ fontSize: 12 }}>{String(v.code)}</Text>}
        </div>
      </Space>
    );
  },

  titleDescription: (v, row) => {
    if (!v) return <Text type="secondary">—</Text>;
    if (typeof v === 'string') return <Text>{v}</Text>;
    const windowLabel = row?.windowLabel as string | undefined;
    return (
      <div>
        {v.title && (
          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{String(v.title)}</span>
            {windowLabel && (
              <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>🕒 {windowLabel}</Tag>
            )}
          </div>
        )}
        {v.description && <Text type="secondary" style={{ fontSize: 12 }}>{String(v.description)}</Text>}
      </div>
    );
  },

  instrument: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    if (Array.isArray(v)) {
      return (
        <Space wrap size={4}>
          {v.map((it: Any, i: number) => (
            <Tag key={i} style={{ margin: 0 }}>{String(it.code ?? it.name ?? it)}</Tag>
          ))}
        </Space>
      );
    }
    return (
      <div>
        <div style={{ fontWeight: 500 }}>{String(v.code ?? v.name ?? '—')}</div>
        {v.name && v.code && <Text type="secondary" style={{ fontSize: 11 }}>{String(v.name)}</Text>}
      </div>
    );
  },

  tag: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    const list = Array.isArray(v) ? v : (v.tags ?? [v]);
    if (!list.length) return <Text type="secondary">—</Text>;
    return (
      <Space wrap size={4}>
        {list.map((t: Any, i: number) => {
          const label = typeof t === 'string' ? t : (t?.label ?? t?.name ?? JSON.stringify(t));
          const color = typeof t === 'object' && t?.color ? String(t.color) : undefined;
          return <Tag key={i} color={color} style={{ margin: 0 }}>{String(label)}</Tag>;
        })}
      </Space>
    );
  },

  pnlColumn: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    const amt = typeof v.amount === 'number' ? v.amount : undefined;
    return (
      <div>
        <div style={{ color: pnlColor(amt), fontWeight: 600 }}>{fmtCurrency(v.currency as string, amt)}</div>
        {v.volumeOfTrades != null && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            Vol: {fmtCurrency(v.currency as string, Number(v.volumeOfTrades))}
          </Text>
        )}
      </div>
    );
  },

  pnlDuration: (v, row, col) => {
    if (v == null) return <Text type="secondary">—</Text>;
    // pnlPercentage vs pnlAbsolute differ by dataIndex
    const isPct = col?.dataIndex === 'pnlPercentage';
    if (typeof v === 'number') {
      return <span style={{ color: pnlColor(v), fontWeight: 600 }}>{fmtNum(v)}{isPct ? '%' : ''}</span>;
    }
    if (typeof v === 'object') {
      const n = typeof v.value === 'number' ? v.value : typeof v.amount === 'number' ? v.amount : undefined;
      return <span style={{ color: pnlColor(n), fontWeight: 600 }}>{fmtNum(n)}{isPct ? '%' : (v.currency ?? '')}</span>;
    }
    return <Text>{String(v)}</Text>;
  },

  entryExit: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    return (
      <div>
        {v.price != null && <div style={{ fontWeight: 500 }}>{fmtCurrency(v.currency as string, Number(v.price))}</div>}
        {v.timestamp && <Text type="secondary" style={{ fontSize: 11 }}>{String(v.timestamp)}</Text>}
        {v.quantity != null && <Text type="secondary" style={{ fontSize: 11 }}>{' · Qty: '}{fmtNum(v.quantity)}</Text>}
      </div>
    );
  },

  iconTitle: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    if (typeof v === 'string') return <Text>{v}</Text>;
    return (
      <Space>
        {v.icon && <span style={{ fontSize: 14 }}>{String(v.icon).slice(0, 1)}</span>}
        <div>
          {v.title && <div style={{ fontWeight: 500 }}>{String(v.title)}</div>}
          {v.subtitle && <Text type="secondary" style={{ fontSize: 11 }}>{String(v.subtitle)}</Text>}
        </div>
      </Space>
    );
  },

  badge: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    const label = typeof v === 'string' ? v : String(v.label ?? v.name ?? v.type ?? '—');
    const color = typeof v === 'object' ? (v.color as string | undefined) : undefined;
    return <Tag color={color}>{label}</Tag>;
  },

  buttonLink: (v, row) => {
    const label = (typeof v === 'object' && v?.label) ? String(v.label) : 'Open';
    return <Button type="link" size="small">{label} <RightOutlined /></Button>;
  },

  executeButton: () => <Button type="primary" size="small" icon={<PlayCircleOutlined />}>Execute</Button>,
  startButton: () => <Button type="primary" size="small" icon={<PlayCircleOutlined />}>Start</Button>,
  newStartButton: () => <Button type="primary" size="small" icon={<PlusOutlined />}>Start</Button>,

  expandable: () => <Button type="text" size="small" icon={<RightOutlined />} />,

  delete: () => <Button type="text" danger size="small" icon={<DeleteOutlined />} />,

  switch: (v) => <Switch checked={Boolean(v)} disabled />,

  editBroker: () => <Button type="link" size="small" icon={<EditOutlined />}>Edit</Button>,

  brokerDetail: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    if (typeof v === 'string') return <Text>{v}</Text>;
    return (
      <div>
        <div style={{ fontWeight: 500 }}>{String(v.name ?? '—')}</div>
        {v.accountId && (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 11 }}>{String(v.accountId)}</Text>
            <CopyOutlined style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer' }} />
          </Space>
        )}
      </div>
    );
  },

  textInfo: (v) => {
    if (v == null || v === '') return <Text type="secondary">—</Text>;
    if (typeof v === 'string' || typeof v === 'number') return <Text>{String(v)}</Text>;
    if (typeof v === 'object') {
      // common shapes: { title, subtitle }, { text, style }
      if (v.title?.text) {
        return (
          <div>
            <div style={{ fontWeight: 500, color: (v.title.style as Any)?.color as string | undefined }}>
              {String(v.title.text)}
            </div>
            {v.subtitle?.text && <Text type="secondary" style={{ fontSize: 12 }}>{String(v.subtitle.text)}</Text>}
          </div>
        );
      }
      if (typeof v.text === 'string') {
        const color = (v.style as Any)?.color as string | undefined;
        return <span style={{ color }}>{v.text}</span>;
      }
      if (v.title && typeof v.title === 'string') return <Text strong>{v.title}</Text>;
    }
    return defaultRender(v);
  },

  planFeatures: (v) => {
    if (!v) return <Text type="secondary">—</Text>;
    const features = Array.isArray(v) ? v : (v.features as Array<Any> | undefined);
    if (!features || !features.length) {
      return v.label ? <Text>{String(v.label)}</Text> : <Text type="secondary">—</Text>;
    }
    return (
      <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
        {features.slice(0, 4).map((f, i) => (
          <Tooltip key={i} title={f.tooltip}>
            <Space size={4}>
              <Text type="secondary">{String(f.label ?? '—')}</Text>
              {f.tooltip && <Text type="secondary" style={{ fontSize: 10 }}>· {String(f.tooltip).slice(0, 30)}</Text>}
            </Space>
          </Tooltip>
        ))}
        {features.length > 4 && <Text type="secondary" style={{ fontSize: 10 }}>+{features.length - 4} more</Text>}
      </Space>
    );
  },

  planPurchaseBtn: (v) => {
    const label = typeof v === 'object' && v?.label ? String(v.label) : 'Renew';
    return <Button type="primary" size="small">{label}</Button>;
  },

  numberOfTrades: (v) => {
    if (v == null) return <Text type="secondary">0</Text>;
    if (typeof v === 'number') return <Text strong>{fmtNum(v, 0)}</Text>;
    if (typeof v === 'object') return <Text strong>{fmtNum(v.count ?? v.value ?? 0, 0)}</Text>;
    return <Text>{String(v)}</Text>;
  },
};

// ---------- Default renderer (fallback) ----------

export function defaultRender(value: unknown): React.ReactNode {
  if (value == null || value === '') return <Text type="secondary">—</Text>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <Text>{String(value)}</Text>;
  }
  // Unknown object shape — compact JSON.
  try {
    const s = JSON.stringify(value);
    return (
      <Tooltip title={s}>
        <Text type="secondary" style={{ fontSize: 11 }} ellipsis>{s.slice(0, 60)}</Text>
      </Tooltip>
    );
  } catch {
    return <Text type="secondary">—</Text>;
  }
}
