import { PageHeader } from "@/components/page-header";
import { algos, optionChain, futures } from "@/lib/mock/seed";
import { classForChange, formatINR, formatNumber, formatPct } from "@/lib/utils";
import {
  BarChart3, CircuitBoard, Flame, PlayCircle, PauseCircle, ShoppingCart,
  TrendingUp, Users,
} from "lucide-react";

const STATE_STYLE: Record<string, string> = {
  Live:  "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  Paper: "bg-primary/10 text-primary",
  Idle:  "bg-muted text-muted-foreground",
};

export default function AlgosPage() {
  const featured  = algos.slice(0, 3);
  const marketplace = algos;

  return (
    <>
      <PageHeader
        title="BullsAi — Algo Trading"
        subtitle="Pre-built, backtested strategies. Deploy to Paper or Live with one click."
        actions={
          <div className="flex gap-2">
            <button className="btn-outline"><CircuitBoard className="h-4 w-4 mr-1" /> Strategy Builder</button>
            <button className="btn-primary"><ShoppingCart className="h-4 w-4 mr-1" /> Vault</button>
          </div>
        }
      />

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat title="Your live algos"     value="2" icon={<PlayCircle className="h-4 w-4" />} tone="success" />
        <Stat title="Paper running"       value="1" icon={<PauseCircle className="h-4 w-4" />} tone="primary" />
        <Stat title="Marketplace strategies" value={String(algos.length)} icon={<Flame className="h-4 w-4" />} />
        <Stat title="Subscribers across algos" value={formatNumber(algos.reduce((s, a) => s + a.subscribers, 0))} icon={<Users className="h-4 w-4" />} />
      </section>

      {/* Featured */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Featured</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {featured.map(a => (
            <div key={a.id} className="card">
              <div className="card-header flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge-muted">{a.segment}</span>
                    <span className="badge-muted">{a.kind}</span>
                  </div>
                  <div className="font-medium mt-1">{a.name}</div>
                  <div className="text-xs text-muted-foreground">by {a.author}</div>
                </div>
                <span className={"text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded " + STATE_STYLE[a.state]}>
                  {a.state}
                </span>
              </div>
              <div className="card-body space-y-3 text-sm">
                <p className="text-muted-foreground">{a.description}</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Metric label="CAGR"     value={<span className={classForChange(a.cagr)}>{a.cagr}%</span>} />
                  <Metric label="Win rate" value={`${a.winRate}%`} />
                  <Metric label="Max DD"   value={<span className="text-[hsl(var(--danger))]">-{a.maxDd}%</span>} />
                  <Metric label="Sharpe"   value={a.sharpe.toFixed(1)} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{formatNumber(a.subscribers)} subscribers</span>
                  <span className="font-medium">{formatINR(a.priceMonthly)}/mo</span>
                </div>
                <div className="flex gap-2">
                  <button className="btn-outline flex-1"><BarChart3 className="h-3.5 w-3.5 mr-1" />Backtest</button>
                  <button className="btn-primary flex-1"><PlayCircle className="h-3.5 w-3.5 mr-1" />Deploy</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Full marketplace table */}
      <section className="card">
        <div className="card-header flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          <span className="font-medium">Vault — Strategy Marketplace</span>
        </div>
        <div className="card-body">
          <table className="table-base">
            <thead>
              <tr>
                <th>Strategy</th><th>Segment</th><th>Type</th>
                <th>CAGR</th><th>Win %</th><th>Max DD</th><th>Sharpe</th>
                <th>Subscribers</th><th>Price</th><th>State</th><th></th>
              </tr>
            </thead>
            <tbody>
              {marketplace.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">by {a.author}</div>
                  </td>
                  <td>{a.segment}</td>
                  <td>{a.kind}</td>
                  <td className={classForChange(a.cagr)}>{a.cagr}%</td>
                  <td>{a.winRate}%</td>
                  <td className="text-[hsl(var(--danger))]">-{a.maxDd}%</td>
                  <td>{a.sharpe.toFixed(1)}</td>
                  <td>{formatNumber(a.subscribers)}</td>
                  <td>{formatINR(a.priceMonthly)}/mo</td>
                  <td>
                    <span className={"text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded " + STATE_STYLE[a.state]}>
                      {a.state}
                    </span>
                  </td>
                  <td><button className="btn-outline text-xs">Deploy</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Option Chain & Futures side-by-side */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="font-medium">Option Chain — NIFTY</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Spot <span className="font-medium text-foreground">{formatNumber(optionChain.NIFTY.spot)}</span> · Exp {optionChain.NIFTY.expiry}
            </div>
          </div>
          <div className="card-body overflow-x-auto">
            <OptionChainTable spot={optionChain.NIFTY.spot} rows={optionChain.NIFTY.rows} />
          </div>
        </div>
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="font-medium">Futures — Near-Month</span>
          </div>
          <div className="card-body">
            <table className="table-base">
              <thead><tr>
                <th>Contract</th><th>LTP</th><th>Chg</th><th>% Chg</th><th>Lot</th><th>Margin</th>
              </tr></thead>
              <tbody>
                {futures.map(f => (
                  <tr key={f.symbol}>
                    <td>
                      <div className="font-medium">{f.symbol}</div>
                      <div className="text-xs text-muted-foreground">Exp {f.expiry}</div>
                    </td>
                    <td>{formatNumber(f.ltp)}</td>
                    <td className={classForChange(f.dayChange)}>{f.dayChange > 0 ? "+" : ""}{formatNumber(f.dayChange)}</td>
                    <td className={classForChange(f.dayChangePct)}>{formatPct(f.dayChangePct)}</td>
                    <td>{f.lotSize}</td>
                    <td>{f.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ title, value, icon, tone }: { title: string; value: string; icon: React.ReactNode; tone?: "success" | "primary" }) {
  const toneCls = tone === "success" ? "text-[hsl(var(--success))]" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{title}</div>
        <div className={"text-2xl font-semibold mt-1 " + toneCls}>{value}</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function OptionChainTable({ spot, rows }: { spot: number; rows: typeof optionChain.NIFTY.rows }) {
  return (
    <table className="table-base text-xs">
      <thead>
        <tr>
          <th className="text-right">CE OI</th>
          <th className="text-right">CE LTP</th>
          <th className="text-right">CE Chg</th>
          <th className="text-center">Strike</th>
          <th className="text-right">PE LTP</th>
          <th className="text-right">PE Chg</th>
          <th className="text-right">PE OI</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const atm = Math.abs(r.strike - spot) < 100;
          return (
            <tr key={r.strike} className={atm ? "bg-primary/5" : ""}>
              <td className="text-right">{formatNumber(r.ceOi)}</td>
              <td className="text-right font-medium">{formatNumber(r.ceLtp)}</td>
              <td className={"text-right " + classForChange(r.ceChg)}>{r.ceChg > 0 ? "+" : ""}{r.ceChg}</td>
              <td className="text-center font-semibold">{r.strike}</td>
              <td className="text-right font-medium">{formatNumber(r.peLtp)}</td>
              <td className={"text-right " + classForChange(-r.peChg)}>{r.peChg > 0 ? "+" : ""}{r.peChg}</td>
              <td className="text-right">{formatNumber(r.peOi)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
