// Polling variant of ApiTable that refreshes every N ms so live simulator
// state appears in the UI without a page reload.

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Alert, Button, Card, Space, Table, Typography } from 'antd';
import { ReloadOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { defaultRender, renderers } from './renderers';
import type { ApiColumn, ApiColumnsResponse, ApiPaginated } from './index';

const { Text } = Typography;

function parseWidth(w: unknown): number | string | undefined {
  if (w == null) return undefined;
  if (typeof w === 'number') return w;
  if (typeof w === 'string') return w;
  return undefined;
}

function adaptColumns(
  apiCols: ApiColumn[],
  customRender?: Record<string, (row: Record<string, unknown>) => React.ReactNode>,
): ColumnsType<Record<string, unknown>> {
  return apiCols.map((c, idx) => {
    const key = c.dataIndex || c.key || `col-${idx}`;
    const render = (value: unknown, row: Record<string, unknown>) => {
      // custom renderer by dataIndex (for action columns where we inject onClick)
      if (c.dataIndex && customRender?.[c.dataIndex as string]) {
        return customRender[c.dataIndex as string](row);
      }
      const vt = c.valueType;
      if (vt && renderers[vt]) {
        return renderers[vt](value as Record<string, unknown> | undefined, row, c);
      }
      return defaultRender(value);
    };
    return {
      title: c.title,
      dataIndex: c.dataIndex as string,
      key,
      width: parseWidth(c.width),
      align: c.align,
      fixed: c.fixed,
      ellipsis: c.ellipsis as boolean | undefined,
      render,
    };
  });
}

export type LiveApiTableProps = {
  title?: React.ReactNode;
  fetchColumns: () => Promise<ApiColumnsResponse>;
  fetchData: (params: { pageSize: number; currentPage: number }) => Promise<ApiPaginated>;
  pollMs?: number;
  initialPageSize?: number;
  rowKey?: string;
  customRender?: Record<string, (row: Record<string, unknown>) => React.ReactNode>;
  headerExtra?: React.ReactNode;
};

export function LiveApiTable({
  title,
  fetchColumns,
  fetchData,
  pollMs = 3000,
  initialPageSize = 10,
  rowKey = 'key',
  customRender,
  headerExtra,
}: LiveApiTableProps) {
  const [apiCols, setApiCols] = useState<ApiColumn[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function refresh() {
    const [colsR, dataR] = await Promise.allSettled([
      fetchColumns(),
      fetchData({ pageSize, currentPage: page }),
    ]);
    if (!mounted.current) return;
    if (colsR.status === 'fulfilled') setApiCols(colsR.value.columns ?? []);
    if (dataR.status === 'fulfilled') {
      setRows(dataR.value.data ?? []);
      setTotal(dataR.value.total ?? 0);
      setError(null);
    } else if (colsR.status === 'rejected') {
      setError([colsR, dataR].filter((r) => r.status === 'rejected').map((r) => {
        const e = (r as PromiseRejectedResult).reason;
        return e instanceof Error ? e.message : String(e);
      }).join('; '));
    }
    setLoadedOnce(true);
    setLastRefreshAt(new Date());
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, pageSize]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => { refresh(); }, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, pollMs, page, pageSize]);

  const columns = useMemo(() => adaptColumns(apiCols, customRender), [apiCols, customRender]);

  const titleBar = (
    <Space size={8}>
      {title}
      {lastRefreshAt && (
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
          updated {lastRefreshAt.toLocaleTimeString()}
        </Text>
      )}
    </Space>
  );

  const extra = (
    <Space size={8}>
      {headerExtra}
      <Button
        size="small"
        type="text"
        icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
        onClick={() => setPaused((p) => !p)}
      >
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size="small" type="text" icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
    </Space>
  );

  return (
    <Card title={titleBar} extra={extra} size="small" bodyStyle={{ padding: 0 }}>
      {error && <Alert type="error" message={error} showIcon style={{ margin: 12 }} />}
      <Table
        columns={columns}
        dataSource={rows}
        rowKey={rowKey}
        loading={!loadedOnce}
        size="middle"
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [5, 10, 20, 50],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </Card>
  );
}
