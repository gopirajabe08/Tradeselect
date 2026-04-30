/**
 * Daily Telegram briefings — morning + end-of-day.
 *
 * Why: the user's hands-free workflow says "watch Telegram only". Without these
 * pings, the system runs invisibly. Morning briefing tells them what's armed
 * for the day; EOD summary tells them what happened.
 *
 * The scheduler calls `maybeSendMorningBriefing()` and `maybeSendEodBriefing()`
 * on every tick. Each is gated by an on-disk "already-sent" date stamp so a
 * server restart mid-day doesn't double-send.
 */
import { promises as fs } from "fs";
import path from "path";
import { notify } from "@/lib/notify/telegram";
import { readState as readPaperState } from "@/lib/broker/paper/store";
import { readMode } from "@/lib/broker/mode";
import { readLastRegime } from "./generator";
import { readOverrides } from "./strategy-overrides";
import { STRATEGIES } from "./strategies";
import { readAudit } from "@/lib/broker/audit";
import { readCalls } from "./store";
import { istDateString, isNseHoliday } from "@/lib/market/holidays";
import { runDailySelfImprovement, formatSelfImprovement } from "./daily-self-improvement";
import { computeLiveReadiness, formatLiveReadiness } from "./live-readiness";

const STAMP_FILE = path.join(process.cwd(), ".local-data", "briefing-stamps.json");

type Stamps = { lastMorning?: string; lastMidday?: string; lastEod?: string; lastWeekly?: string };

async function readStamps(): Promise<Stamps> {
  try { return JSON.parse(await fs.readFile(STAMP_FILE, "utf8")); } catch { return {}; }
}
async function writeStamps(s: Stamps): Promise<void> {
  await fs.mkdir(path.dirname(STAMP_FILE), { recursive: true });
  await fs.writeFile(STAMP_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Returns IST minutes since midnight. */
function istMinutes(d = new Date()): number {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// Windows are wide enough that a 30-min scheduler tick from any server-start time
// will land inside at least once. Each briefing self-deduplicates via sent-stamp.
const MORNING_WINDOW = { from: 9 * 60 + 15, to: 10 * 60 };       // 09:15–10:00 IST
const MIDDAY_WINDOW  = { from: 12 * 60 + 30, to: 13 * 60 + 30 }; // 12:30–13:30 IST
const EOD_WINDOW     = { from: 15 * 60 + 30, to: 16 * 60 + 30 }; // 15:30–16:30 IST

export async function maybeSendMorningBriefing(force = false): Promise<boolean> {
  const today = istDateString();
  if (!force && isNseHoliday(today)) return false;
  const min = istMinutes();
  if (!force && (min < MORNING_WINDOW.from || min > MORNING_WINDOW.to)) return false;

  const stamps = await readStamps();
  if (!force && stamps.lastMorning === today) return false;

  const mode = await readMode();
  const regime = await readLastRegime();
  const overrides = await readOverrides();
  const enabled = STRATEGIES.filter(s => !overrides.overrides.find(o => o.id === s.id && o.disabled));
  const disabled = overrides.overrides.filter(o => o.disabled).map(o => o.id);

  const lines: string[] = [];
  lines.push(`☀️ *TradeSelect — Morning briefing ${today}*`);
  lines.push(``);
  lines.push(`Mode: *${mode}* ${mode === "paper" ? "(simulated)" : "(LIVE — real money)"}`);
  if (regime) {
    lines.push(`Regime: *${regime.regime}* (breadth ${regime.breadthPct.toFixed(0)}%, VIX ${regime.vix.toFixed(1)})`);
  } else {
    lines.push(`Regime: not yet computed (boot probe pending)`);
  }
  lines.push(``);

  if (mode === "paper") {
    const s = await readPaperState();
    const openPos = s.positions.filter(p => p.netQty !== 0).length;
    const openOrders = s.orders.filter(o => o.status === 6 || o.status === 4).length;
    lines.push(`💰 Paper account:`);
    lines.push(`  • Cash: ${inr(s.cash)} / Starting: ${inr(s.startingCash)}`);
    lines.push(`  • Open positions: ${openPos} · Open orders: ${openOrders} · Holdings: ${s.holdings.length}`);
  }
  lines.push(``);

  lines.push(`🤖 Auto-follow:`);
  lines.push(`  • Enabled: ${process.env.AUTO_FOLLOW_ENABLED === "1" ? "yes" : "no"}`);
  lines.push(`  • Min score: ${process.env.AUTO_FOLLOW_MIN_SCORE ?? 70}`);
  lines.push(`  • Risk/trade: ${process.env.AUTO_FOLLOW_RISK_PCT ?? 1}%`);
  lines.push(`  • Max open: ${process.env.AUTO_FOLLOW_MAX_OPEN ?? 10}`);
  if (mode !== "paper") {
    const liveOk = process.env.AUTO_FOLLOW_ALLOW_LIVE === "1" && process.env.AUTO_FOLLOW_LIVE_CONFIRMED === "1";
    lines.push(`  • Live auto-fire: ${liveOk ? "ARMED" : "GATED (requires triple env)"}`);
  }
  lines.push(``);

  lines.push(`📊 Strategy book:`);
  lines.push(`  • Active: ${enabled.length} (${enabled.map(s => s.id).join(", ")})`);
  if (disabled.length > 0) {
    lines.push(`  • Disabled: ${disabled.length} (${disabled.join(", ")})`);
  }
  lines.push(``);

  lines.push(`Generator fires every 30 min during market hours. Updates land here on every new idea + every order.`);

  const ok = await notify(lines.join("\n"));
  if (ok) {
    // Only persist the sent-stamp on a real (non-forced) send. Force mode is for
    // previews — writing the stamp would suppress today's real briefing.
    if (!force) await writeStamps({ ...stamps, lastMorning: today });
    console.log(`[briefing] morning sent for ${today}${force ? " (forced preview, no stamp)" : ""}`);
  }
  return ok;
}

export async function maybeSendMiddayBriefing(force = false): Promise<boolean> {
  const today = istDateString();
  if (!force && isNseHoliday(today)) return false;
  const min = istMinutes();
  if (!force && (min < MIDDAY_WINDOW.from || min > MIDDAY_WINDOW.to)) return false;

  const stamps = await readStamps();
  if (!force && stamps.lastMidday === today) return false;

  const mode = await readMode();
  const regime = await readLastRegime();
  const audit = await readAudit(2000);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayAudit = audit.filter(e => e.at.startsWith(todayIso));
  const placed = todayAudit.filter(e => e.action === "place" && e.result === "ok").length;
  const placeErrors = todayAudit.filter(e => e.action === "place" && e.result === "error").length;
  const autoFollowOk = todayAudit.filter(e => e.action === "auto-follow" && e.result === "ok").length;

  const lines: string[] = [];
  lines.push(`☀️ *Midday status ${today}*`);
  lines.push(``);
  lines.push(`Mode: *${mode}* · Regime: *${regime?.regime ?? "?"}*${regime ? ` (breadth ${regime.breadthPct.toFixed(0)}%, VIX ${regime.vix.toFixed(1)})` : ""}`);
  lines.push(``);

  if (mode === "paper") {
    const s = await readPaperState();
    const openPos = s.positions.filter(p => p.netQty !== 0).length;
    const realized = s.positions.reduce((sum, p) => sum + (p.realized ?? 0), 0);
    const unreal = s.positions.reduce((sum, p) => sum + (p.netQty !== 0 ? (p.ltp - p.netAvg) * p.netQty : 0), 0)
                 + s.holdings.reduce((sum, h) => sum + (h.pl ?? 0), 0);
    const startCash = s.dayStartCash ?? s.startingCash;
    const pnlPct = startCash > 0 ? ((realized + unreal) / startCash) * 100 : 0;
    lines.push(`💼 Paper:`);
    lines.push(`  • Cash: ${inr(s.cash)} · Open positions: ${openPos}`);
    lines.push(`  • Realized: ${realized >= 0 ? "+" : ""}${inr(realized)} · Unrealized: ${unreal >= 0 ? "+" : ""}${inr(unreal)}`);
    lines.push(`  • Day P&L: ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`);
  }
  lines.push(``);
  lines.push(`📊 Today: ${autoFollowOk} auto-follows · ${placed} orders · ${placeErrors} errors`);
  lines.push(``);
  lines.push(`Half day done. EOD summary at 15:30+ IST.`);

  const ok = await notify(lines.join("\n"));
  if (ok) {
    if (!force) await writeStamps({ ...stamps, lastMidday: today });
    console.log(`[briefing] midday sent for ${today}${force ? " (forced preview, no stamp)" : ""}`);
  }
  return ok;
}

export async function maybeSendEodBriefing(force = false): Promise<boolean> {
  const today = istDateString();
  if (!force && isNseHoliday(today)) return false;
  const min = istMinutes();
  if (!force && (min < EOD_WINDOW.from || min > EOD_WINDOW.to)) return false;

  const stamps = await readStamps();
  if (!force && stamps.lastEod === today) return false;

  const mode = await readMode();
  const audit = await readAudit(2000);
  const todayAudit = audit.filter(e => e.at.startsWith(new Date().toISOString().slice(0, 10)));
  const placed = todayAudit.filter(e => e.action === "place" && e.result === "ok").length;
  const placeErrors = todayAudit.filter(e => e.action === "place" && e.result === "error").length;
  const autoFollows = todayAudit.filter(e => e.action === "auto-follow").length;
  const autoFollowOk = todayAudit.filter(e => e.action === "auto-follow" && e.result === "ok").length;
  const cancels = todayAudit.filter(e => e.action === "cancel").length;

  const calls = await readCalls();
  const todaysIso = new Date().toISOString().slice(0, 10);
  const todayCalls = calls.filter(c => c.issuedAt.startsWith(todaysIso));
  const targetHits = todayCalls.filter(c => c.status === "Target Hit").length;
  const stopHits   = todayCalls.filter(c => c.status === "SL Hit").length;
  const active     = todayCalls.filter(c => c.status === "Active").length;

  const lines: string[] = [];
  lines.push(`🌙 *TradeSelect — EOD summary ${today}*`);
  lines.push(``);
  lines.push(`Mode: *${mode}*`);
  lines.push(``);
  lines.push(`💼 Today's activity:`);
  lines.push(`  • Auto-follow placements: ${autoFollowOk}/${autoFollows}`);
  lines.push(`  • Total orders placed: ${placed} (${placeErrors} errors)`);
  lines.push(`  • OCO/manual cancellations: ${cancels}`);
  lines.push(``);

  lines.push(`📊 Today's ideas (${todayCalls.length}):`);
  lines.push(`  • 🏆 Target hits: ${targetHits}`);
  lines.push(`  • ❌ Stop hits: ${stopHits}`);
  lines.push(`  • ⌛ Still active: ${active}`);
  lines.push(``);

  if (mode === "paper") {
    const s = await readPaperState();
    const realized = s.positions.reduce((sum, p) => sum + (p.realized ?? 0), 0);
    const unreal   = s.positions.reduce((sum, p) => sum + (p.netQty !== 0 ? (p.ltp - p.netAvg) * p.netQty : 0), 0)
                   + s.holdings.reduce((sum, h) => sum + (h.pl ?? 0), 0);
    const totalCosts = s.totalCosts ?? 0;
    lines.push(`💰 Paper P&L:`);
    lines.push(`  • Realized: ${realized >= 0 ? "+" : ""}${inr(realized)}`);
    lines.push(`  • Unrealized (open): ${unreal >= 0 ? "+" : ""}${inr(unreal)}`);
    lines.push(`  • Cumulative costs (STT/brokerage/etc): ${inr(totalCosts)}`);
    lines.push(`  • Cash: ${inr(s.cash)} / Start of day: ${inr(s.dayStartCash ?? s.startingCash)}`);
  }
  lines.push(``);

  // ── Daily journal entry — pattern recognition over time ──
  const regime = await readLastRegime();
  const winner = todayCalls
    .filter(c => c.status === "Target Hit" && c.closedPrice != null)
    .map(c => ({ sym: c.symbol, pct: ((c.closedPrice! - c.entry) / c.entry) * 100 * (c.side === "BUY" ? 1 : -1) }))
    .sort((a,b) => b.pct - a.pct)[0];
  const loser = todayCalls
    .filter(c => c.status === "SL Hit" && c.closedPrice != null)
    .map(c => ({ sym: c.symbol, pct: ((c.closedPrice! - c.entry) / c.entry) * 100 * (c.side === "BUY" ? 1 : -1) }))
    .sort((a,b) => a.pct - b.pct)[0];
  const todayStrats = new Map<string, number>();
  for (const c of todayCalls) {
    const stratName = c.analyst.replace(" (BullsAi Auto)", "");
    todayStrats.set(stratName, (todayStrats.get(stratName) ?? 0) + 1);
  }
  lines.push(`📓 *Daily journal*:`);
  lines.push(`  • Regime: ${regime?.regime ?? "?"} (breadth ${regime?.breadthPct.toFixed(0) ?? "?"}%, VIX ${regime?.vix.toFixed(1) ?? "?"})`);
  if (todayStrats.size === 0) {
    lines.push(`  • No strategies fired today`);
  } else {
    lines.push(`  • Strategies fired: ${[...todayStrats.entries()].map(([s,n]) => `${s} ×${n}`).join(", ")}`);
  }
  if (winner) lines.push(`  • Best: ${winner.sym} +${winner.pct.toFixed(2)}%`);
  if (loser)  lines.push(`  • Worst: ${loser.sym} ${loser.pct.toFixed(2)}%`);
  if (!winner && !loser) lines.push(`  • No closed trades today`);
  lines.push(``);

  // ── Auto-improvements section — runs the self-improvement loop, then reports decisions ──
  // Decisions are auto-applied; this is the audit trail.
  try {
    const selfImpReport = await runDailySelfImprovement();
    lines.push(formatSelfImprovement(selfImpReport));
    lines.push(``);
  } catch (e) {
    lines.push(`🤖 Auto-improvement run failed: ${(e as Error).message}`);
    lines.push(``);
  }

  // ── Live-readiness scorecard — progress against the 5 bars from edge_definition ──
  try {
    const readiness = await computeLiveReadiness();
    lines.push(formatLiveReadiness(readiness));
  } catch (e) {
    lines.push(`🎯 Live-readiness compute failed: ${(e as Error).message}`);
  }

  const ok = await notify(lines.join("\n"));
  if (ok) {
    if (!force) await writeStamps({ ...stamps, lastEod: today });
    console.log(`[briefing] EOD sent for ${today}${force ? " (forced preview, no stamp)" : ""}`);
  }
  return ok;
}

// ── Weekly per-strategy P&L digest (Sundays 18:00–19:00 IST) ──
const WEEKLY_WINDOW = { from: 18 * 60, to: 19 * 60 };

export async function maybeSendWeeklyDigest(force = false): Promise<boolean> {
  const today = istDateString();
  const now = new Date();
  const istDow = new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCDay();
  // Sunday = 0
  if (!force && istDow !== 0) return false;
  const min = istMinutes();
  if (!force && (min < WEEKLY_WINDOW.from || min > WEEKLY_WINDOW.to)) return false;

  const stamps = await readStamps();
  if (!force && stamps.lastWeekly === today) return false;

  const calls = await readCalls();
  // Last 7 days of closed BullsAi Auto calls
  const cutoffMs = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = calls.filter(c =>
    Date.parse(c.issuedAt) >= cutoffMs &&
    c.analyst.endsWith("(BullsAi Auto)") &&
    (c.status === "Target Hit" || c.status === "SL Hit") &&
    c.closedPrice != null
  );
  type Bucket = { trades: number; wins: number; sumPct: number };
  const byStrat = new Map<string, Bucket>();
  for (const c of recent) {
    const sName = c.analyst.replace(" (BullsAi Auto)", "");
    const pct = ((c.closedPrice! - c.entry) / c.entry) * 100 * (c.side === "BUY" ? 1 : -1);
    const b = byStrat.get(sName) ?? { trades: 0, wins: 0, sumPct: 0 };
    b.trades += 1;
    if (pct > 0) b.wins += 1;
    b.sumPct += pct;
    byStrat.set(sName, b);
  }

  const lines: string[] = [];
  lines.push(`📈 *Weekly digest — last 7 days*`);
  lines.push(``);
  if (recent.length === 0) {
    lines.push(`No closed auto-trades in the last 7 days. Either market was quiet or strategies didn't fire enough — needs more time before any cull verdict.`);
  } else {
    lines.push(`Total closed auto-trades: ${recent.length}`);
    lines.push(``);
    lines.push(`Per strategy (last 7 days):`);
    const sorted = [...byStrat.entries()].sort((a,b) => b[1].sumPct - a[1].sumPct);
    for (const [name, b] of sorted) {
      const winRate = b.trades > 0 ? Math.round((b.wins / b.trades) * 100) : 0;
      const avg = b.sumPct / b.trades;
      const flag = avg < 0 ? "🔴" : avg > 0.5 ? "🟢" : "🟡";
      lines.push(`  ${flag} *${name}*: ${b.trades} trades · ${winRate}% win · avg ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%/trade`);
    }
    lines.push(``);
    lines.push(`Auto-cull threshold: ${process.env.AUTO_CULL_MIN_TRADES ?? 20} trades + Sharpe<0 → strategy disabled. Strategies marked 🔴 risk being culled if pattern continues.`);
  }

  const ok = await notify(lines.join("\n"));
  if (ok) {
    if (!force) await writeStamps({ ...stamps, lastWeekly: today });
    console.log(`[briefing] weekly digest sent for ${today}${force ? " (forced preview, no stamp)" : ""}`);
  }
  return ok;
}
