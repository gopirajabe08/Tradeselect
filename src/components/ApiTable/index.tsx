import React, { useEffect, useState, useMemo } from 'react';
import { Alert, Card, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { defaultRender, renderers } from './renderers';

export type ApiColumn = {
  title?: string;
  dataIndex?: string;
  key?: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  fixed?: 'left' | 'right';
  valueType?: string;
  ellipsis?: boolean;
  isForceNoTitle?: boolean;
  [k: string]: unknown;
};

export type ApiColumnsResponse = { columns: ApiColumn[] };
export type ApiPaginated<T = Record<string, unknown>> = {
  data: T[];
  total: number;
  pageSize: number;
  currentPage: number;
};

function parseWidth(w: unknown): number | string | undefined {
  if (w == null) return undefined;
  if (typeof w === 'number') return w;
  if (typeof w === 'string') return w;
  return undefined;
}

function adaptColumns(apiCols: ApiColumn[]): ColumnsType<Record<string, unknown>> {
  return apiCols.map((c, idx) => {
    const key = c.dataIndex || c.key || `col-${idx}`;
    const render = (value: unknown, row: Record<string, unknown>) => {
      const vt = c.valueType;
      if (vt && renderers[vt]) {
        return renderers[vt](value as Record<string, unknown> | undefined, row, c);
      }
      return defaultRender(value);
    };
    return {
      title: c.isForceNoTitle ? c.title : c.title,
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

export type ApiTableProps = {
  title?: React.ReactNode;
  fetchColumns: () => Promise<ApiColumnsResponse>;
  fetchData: (params: { pageSize: number; currentPage: number }) => Promise<ApiPaginated>;
  initialPageSize?: number;
  rowKey?: string;
  empty?: React.ReactNode;
};

export function ApiTable({
  title,
  fetchColumns,
  fetchData,
  initialPageSize = 10,
  rowKey = 'key',
  empty,
}: ApiTableProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiCols, setApiCols] = useState<ApiColumn[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [colsR, dataR] = await Promise.allSettled([
        fetchColumns(),
        fetchData({ pageSize, currentPage: page }),
      ]);
      if (!mounted) return;
      const errs: string[] = [];
      if (colsR.status === 'fulfilled') setApiCols(colsR.value.columns ?? []);
      else errs.push(colsR.reason instanceof Error ? colsR.reason.message : String(colsR.reason));
      if (dataR.status === 'fulfilled') {
        setRows(dataR.value.data ?? []);
        setTotal(dataR.value.total ?? 0);
      } else {
        errs.push(dataR.reason instanceof Error ? dataR.reason.message : String(dataR.reason));
      }
      if (errs.length && (colsR.status === 'rejected' && dataR.status === 'rejected')) {
        setError(errs.join('; '));
      } else {
        setError(null);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const columns = useMemo(() => adaptColumns(apiCols), [apiCols]);

  const body = (
    <>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      <Table
        columns={columns}
        dataSource={rows}
        rowKey={rowKey}
        loading={loading}
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
        locale={empty ? { emptyText: empty } : undefined}
      />
    </>
  );

  if (!title) return body;
  return (
    <Card title={title} size="small" bodyStyle={{ padding: 0 }}>
      {body}
    </Card>
  );
}
