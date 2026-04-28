import type { Segment, TradeCall } from "./seed";

export function callMetrics(c: TradeCall) {
  const live = c.status === "Active";
  const ref  = live ? c.ltp : (c.closedPrice ?? c.ltp);
  const raw  = c.side === "BUY" ? (ref - c.entry) : (c.entry - ref);
  const pct  = (raw / c.entry) * 100;
  const risk    = Math.abs(c.entry - c.stopLoss);
  const reward  = Math.abs(c.target1 - c.entry);
  const rr      = risk > 0 ? reward / risk : 0;
  return { refPrice: ref, pnlPct: pct, riskReward: rr, isLive: live };
}

export function callsBySegment(calls: TradeCall[]) {
  const map = new Map<Segment, TradeCall[]>();
  for (const c of calls) {
    const list = map.get(c.segment) ?? [];
    list.push(c);
    map.set(c.segment, list);
  }
  return map;
}

export function callStats(calls: TradeCall[]) {
  const total     = calls.length;
  const active    = calls.filter(c => c.status === "Active").length;
  const hits      = calls.filter(c => c.status === "Target Hit").length;
  const sls       = calls.filter(c => c.status === "SL Hit").length;
  const closedWin = calls.filter(c => c.status === "Closed" && callMetrics(c).pnlPct > 0).length;
  const decided   = calls.filter(c => c.status !== "Active").length;
  const winRate   = decided === 0 ? 0 : ((hits + closedWin) / decided) * 100;
  const todayIso  = new Date().toISOString().slice(0, 10);
  const newToday  = calls.filter(c => c.issuedAt.slice(0, 10) === todayIso).length;
  return { total, active, hits, sls, winRate, newToday };
}

// ─── Per-analyst / per-strategy performance ─────────────────────────────

export type AnalystKind = "Auto" | "Human";

export type AnalystPerformance = {
  analyst: string;           // normalized label used for grouping/display
  kind: AnalystKind;
  total: number;
  active: number;
  decided: number;
  targetHits: number;
  slHits: number;
  closedWinners: number;
  winRate: number;           // percent; 0 when decided === 0
  avgReturn: number;         // avg % across decided
  bestReturn: number;
  worstReturn: number;
  latestAt: string;          // most recent issuedAt
};

/** Strip the auto-source suffix so "Intraday momentum leader (BullsAi Auto)" groups with itself. */
export function normalizeAnalyst(analyst: string): { label: string; kind: AnalystKind } {
  const m = analyst.match(/^(.*?)\s*\(BullsAi Auto\)\s*$/);
  if (m) return { label: m[1].trim() || analyst, kind: "Auto" };
  return { label: analyst, kind: "Human" };
}

export function performanceByAnalyst(calls: TradeCall[]): AnalystPerformance[] {
  const groups = new Map<string, { kind: AnalystKind; items: TradeCall[] }>();
  for (const c of calls) {
    const { label, kind } = normalizeAnalyst(c.analyst);
    const existing = groups.get(label);
    if (existing) existing.items.push(c);
    else groups.set(label, { kind, items: [c] });
  }

  const rows: AnalystPerformance[] = [];
  groups.forEach(({ kind, items }, label) => {
    const total      = items.length;
    const active     = items.filter(c => c.status === "Active").length;
    const decided    = items.filter(c => c.status !== "Active");
    const targetHits = items.filter(c => c.status === "Target Hit").length;
    const slHits     = items.filter(c => c.status === "SL Hit").length;
    const closedWinners = items.filter(c => c.status === "Closed" && callMetrics(c).pnlPct > 0).length;
    const returns    = decided.map(c => callMetrics(c).pnlPct);
    const avgReturn  = returns.length === 0 ? 0 : returns.reduce((a, b) => a + b, 0) / returns.length;
    const bestReturn = returns.length === 0 ? 0 : Math.max(...returns);
    const worstReturn= returns.length === 0 ? 0 : Math.min(...returns);
    const winRate    = decided.length === 0 ? 0 : ((targetHits + closedWinners) / decided.length) * 100;
    const latestAt   = items.reduce((m, c) => (c.issuedAt > m ? c.issuedAt : m), items[0].issuedAt);

    rows.push({
      analyst: label, kind,
      total, active,
      decided: decided.length, targetHits, slHits, closedWinners,
      winRate, avgReturn, bestReturn, worstReturn,
      latestAt,
    });
  });

  // Default: by win rate (sources with zero decided sink to the bottom).
  return rows.sort((a, b) => {
    if (a.decided === 0 && b.decided === 0) return b.total - a.total;
    if (a.decided === 0) return 1;
    if (b.decided === 0) return -1;
    return b.winRate - a.winRate;
  });
}

export function segmentPerformance(calls: TradeCall[]) {
  const rows: { segment: Segment; total: number; decided: number; winRate: number; avgReturn: number }[] = [];
  const bySeg = callsBySegment(calls);
  bySeg.forEach((list, segment) => {
    const decided = list.filter(c => c.status !== "Active");
    const wins    = decided.filter(c => callMetrics(c).pnlPct > 0);
    const avgRet  = decided.length === 0 ? 0 : decided.reduce((s, c) => s + callMetrics(c).pnlPct, 0) / decided.length;
    rows.push({
      segment,
      total: list.length,
      decided: decided.length,
      winRate: decided.length === 0 ? 0 : (wins.length / decided.length) * 100,
      avgReturn: avgRet,
    });
  });
  return rows.sort((a, b) => b.total - a.total);
}
