import React, { useEffect, useState } from 'react';
import { Modal, Form, Select, InputNumber, Radio, Space, Typography, Spin, Alert, message, Tooltip, Tag } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { listInstruments, listAlgos, startStrategy, type Instrument, type AlgoMeta } from '@/services/trading';
import { request } from '@umijs/max';

type Window = { start: string; end: string; tz?: string; days?: string };
type CatalogEntry = {
  code: string;
  name: string;
  algoKey: string;
  description: string;
  instrument: string;
  minimumCapital: number;
  window?: Window;
  tags?: string[];
};

const { Text } = Typography;

export type StartStrategyInput = {
  strategyCode: string;
  strategyName?: string;
  strategyType?: string;
};

export function StartStrategyModal({
  open,
  onClose,
  onStarted,
  strategy,
}: {
  open: boolean;
  onClose: () => void;
  onStarted?: (instance: { id: number }) => void;
  strategy: StartStrategyInput | null;
}) {
  const [form] = Form.useForm();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [algos, setAlgos] = useState<AlgoMeta[]>([]);
  const [, setMapping] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listInstruments(),
      listAlgos(),
      request<{ catalog: CatalogEntry[] }>('/_sim/catalog', { method: 'GET' }),
    ])
      .then(([inst, a, cat]) => {
        const safeCatalog = cat?.catalog ?? [];
        setInstruments(inst);
        setAlgos(a.algos);
        setMapping(a.mapping);
        setCatalog(safeCatalog);
        const catalogEntry = strategy ? safeCatalog.find((c) => c.code === strategy.strategyCode) : null;
        form.setFieldsValue({
          instrument: catalogEntry?.instrument ?? inst[0]?.code,
          algoKey: catalogEntry?.algoKey ?? 'ma_crossover',
          capital: catalogEntry?.minimumCapital ?? 100000,
          mode: 'PT',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, form, strategy]);

  const catalogEntry = strategy && catalog.length
    ? catalog.find((c) => c.code === strategy.strategyCode)
    : null;

  const onSubmit = async () => {
    if (!strategy) return;
    const values = await form.validateFields();
    const inst = instruments.find((i) => i.code === values.instrument);
    setSubmitting(true);
    try {
      const { instance } = await startStrategy({
        strategyCode: strategy.strategyCode,
        strategyName: strategy.strategyName,
        strategyType: strategy.strategyType,
        algoKey: values.algoKey,
        instrument: values.instrument,
        exchange: inst?.exchange,
        capital: Number(values.capital),
        mode: values.mode,
      });
      const algoName = algos.find((a) => a.key === values.algoKey)?.name ?? values.algoKey;
      message.success(`Started ${strategy.strategyName ?? strategy.strategyCode} (${algoName}) on ${values.instrument} — instance #${instance.id}`);
      onStarted?.(instance);
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedAlgoKey = Form.useWatch('algoKey', form);
  const selectedAlgo = algos.find((a) => a.key === selectedAlgoKey);

  return (
    <Modal
      open={open}
      title={strategy ? `Start strategy: ${strategy.strategyName ?? strategy.strategyCode}` : 'Start strategy'}
      onCancel={onClose}
      onOk={onSubmit}
      confirmLoading={submitting}
      okText="Start"
      destroyOnClose
      width={520}
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      {catalogEntry && (
        <Alert
          type="info"
          showIcon={false}
          style={{ marginBottom: 12, background: '#f0f7ff', borderColor: '#d5e5ff' }}
          message={
            <Space wrap>
              <strong>{catalogEntry.code}</strong>
              <span>·</span>
              <strong>{catalogEntry.name}</strong>
              <Tag color="blue">{catalogEntry.algoKey}</Tag>
              {catalogEntry.window && (
                <Tag color="purple">
                  🕒 {catalogEntry.window.start}–{catalogEntry.window.end} {catalogEntry.window.tz ?? ''}
                </Tag>
              )}
            </Space>
          }
          description={
            <>
              <div style={{ fontSize: 12 }}>{catalogEntry.description}</div>
              {catalogEntry.window && (
                <div style={{ fontSize: 11, marginTop: 6, color: '#6b4f00' }}>
                  ⓘ Trades automatically during this window. Outside the window, open positions auto-close and new entries are skipped. You don't need to watch the market — just start once.
                </div>
              )}
            </>
          }
        />
      )}
      {loading ? (
        <Spin />
      ) : (
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label={<>Algorithm <Tooltip title="Standard indicator-based logic provided by TradeSelect"><InfoCircleOutlined /></Tooltip></>}
            name="algoKey"
            rules={[{ required: true }]}
          >
            <Select
              options={algos.map((a) => ({
                value: a.key,
                label: (
                  <Space>
                    <span>{a.name}</span>
                    <Text type="secondary" style={{ fontSize: 11 }}>({a.key})</Text>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          {selectedAlgo && (
            <div style={{ marginTop: -12, marginBottom: 16, padding: 10, background: '#fafafa', borderRadius: 4, fontSize: 12 }}>
              <Text type="secondary">{selectedAlgo.description}</Text>
              {Object.keys(selectedAlgo.defaultParams ?? {}).length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Default params: {JSON.stringify(selectedAlgo.defaultParams)}</Text>
                </div>
              )}
            </div>
          )}
          <Form.Item label="Instrument" name="instrument" rules={[{ required: true }]}>
            <Select
              options={instruments.map((i) => ({
                value: i.code,
                label: (
                  <Space>
                    <span>{i.code}</span>
                    <Text type="secondary">{i.exchange}</Text>
                    <Text type="secondary">· ₹{i.currentPrice.toFixed(2)}</Text>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item label="Capital (₹)" name="capital" rules={[{ required: true, type: 'number', min: 1000 }]}>
            <InputNumber style={{ width: '100%' }} min={1000} step={10000} />
          </Form.Item>
          <Form.Item label="Mode" name="mode">
            <Radio.Group>
              <Radio.Button value="PT">Paper Trade</Radio.Button>
              <Radio.Button value="BT">Backtest</Radio.Button>
              <Radio.Button value="LT" disabled>Live (off)</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Simulator ticks every 2 seconds. Prices move via geometric Brownian motion with realistic volatility.
            Entries and exits follow your selected indicator logic. Live P&amp;L appears on Portfolio and Book pages.
          </Text>
        </Form>
      )}
    </Modal>
  );
}
