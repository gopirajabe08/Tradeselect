import React, { useState, useRef } from 'react';
import { Card, Button, Space, Select, Row, Col, Typography, message, Alert } from 'antd';
import { SaveOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import Editor, { type OnMount } from '@monaco-editor/react';

const { Title, Text } = Typography;

type Template = { key: string; label: string; code: string };

const TEMPLATES: Template[] = [
  {
    key: 'ma_crossover',
    label: 'MA Crossover (Python template)',
    code: `# Moving Average Crossover Strategy
# Buys when fast SMA crosses above slow SMA; sells on opposite cross.

from tradeselect import Strategy

class MACrossover(Strategy):
    def initialize(self):
        self.fast_period = 5
        self.slow_period = 20
        self.position = None

    def on_bar(self, bar):
        fast = self.sma(bar.close, self.fast_period)
        slow = self.sma(bar.close, self.slow_period)

        if self.position is None and fast > slow:
            self.buy(quantity=self.capital * 0.1 / bar.close)
        elif self.position and fast < slow:
            self.sell(self.position.quantity)

    def on_end(self):
        print(f"Final P&L: {self.realized_pnl:.2f}")
`,
  },
  {
    key: 'rsi_reversion',
    label: 'RSI Mean-Reversion',
    code: `# RSI Mean-Reversion Strategy

from tradeselect import Strategy

class RSIReversion(Strategy):
    def initialize(self):
        self.period = 14
        self.oversold = 30
        self.overbought = 70

    def on_bar(self, bar):
        rsi = self.rsi(bar.close, self.period)
        if self.position is None and rsi < self.oversold:
            self.buy(quantity=self.capital * 0.1 / bar.close, reason=f"RSI {rsi:.1f}")
        elif self.position and rsi > self.overbought:
            self.sell(self.position.quantity, reason=f"RSI {rsi:.1f}")
`,
  },
  {
    key: 'atr_trend',
    label: 'ATR Volatility Trend',
    code: `# ATR Volatility Trend Strategy

from tradeselect import Strategy

class ATRTrend(Strategy):
    def initialize(self):
        self.period = 14
        self.multiplier = 1.5

    def on_bar(self, bar):
        atr = self.atr(bar.close, self.period)
        if atr is None:
            return
        baseline = self.price(5)  # price 5 bars ago
        delta = bar.close - baseline
        if self.position is None and delta > atr * self.multiplier:
            self.buy(quantity=self.capital * 0.1 / bar.close)
        elif self.position:
            move = bar.close - self.position.entry_price
            if move < -atr * self.multiplier:
                self.sell(self.position.quantity, reason="stop")
            elif move > atr * self.multiplier * 2:
                self.sell(self.position.quantity, reason="take profit")
`,
  },
  {
    key: 'blank',
    label: 'Blank template',
    code: `# Your strategy here.
# Available: self.sma, self.ema, self.rsi, self.atr, self.bb, self.macd
#            self.buy(quantity, reason=''), self.sell(quantity, reason='')

from tradeselect import Strategy

class MyStrategy(Strategy):
    def initialize(self):
        pass

    def on_bar(self, bar):
        pass
`,
  },
];

export default function CodeEditor() {
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key);
  const [code, setCode] = useState(TEMPLATES[0].code);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const pickTemplate = (k: string) => {
    const t = TEMPLATES.find((x) => x.key === k);
    if (t) { setTemplateKey(k); setCode(t.code); }
  };

  const onSave = () => {
    localStorage.setItem(`tradeselect_strategy_${templateKey}`, code);
    message.success(`Saved ${templateKey} to local storage`);
  };

  const onRun = async () => {
    setRunning(true);
    setOutput(null);
    // Simulate a "compile+dispatch" step — real execution would POST to a Python runner.
    await new Promise((r) => setTimeout(r, 1200));
    const lines = code.split(/\r?\n/).length;
    const chars = code.length;
    setOutput(`[mock compile] OK — ${lines} lines, ${chars} chars.\n[mock dispatch] Strategy queued on Paper Trading simulator.\n[info] Wire to a real Python runtime (e.g. Pyodide or backend /api/strategy/run) to execute.`);
    setRunning(false);
  };

  return (
    <Card>
      <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={3} style={{ margin: 0, color: '#213654' }}>Strategy Code Editor</Title>
          <Text type="secondary">Write and test Python strategies. Save to local storage; Run sends to the mock runner.</Text>
        </Col>
        <Col>
          <Space>
            <Select
              value={templateKey}
              style={{ width: 280 }}
              onChange={pickTemplate}
              options={TEMPLATES.map((t) => ({ value: t.key, label: t.label }))}
            />
            <Button icon={<PlusOutlined />} onClick={() => pickTemplate('blank')}>New</Button>
            <Button icon={<SaveOutlined />} onClick={onSave}>Save</Button>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={onRun} loading={running}>Run</Button>
          </Space>
        </Col>
      </Row>
      <Editor
        height={420}
        defaultLanguage="python"
        theme="vs-dark"
        value={code}
        onChange={(v) => setCode(v ?? '')}
        onMount={(ed) => { editorRef.current = ed; }}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
      {output && (
        <Alert
          type="info"
          style={{ marginTop: 16 }}
          message="Output"
          description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{output}</pre>}
        />
      )}
    </Card>
  );
}
