// Telegram notifier — single-user push notifications.
// Requires env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Missing → no-op.
//
// Quiet mode (TELEGRAM_QUIET_MODE=1, default ON): suppresses per-event paper
// pings — only briefings (morning/midday/EOD), live orders, and errors fire.
// User asked 2026-04-27: "need only morning brief and health status, EOD
// paper/live status, only live placement notification, any critical issues".

const TAG = "🟢 *TradeSelect*";
const QUIET_MODE = (process.env.TELEGRAM_QUIET_MODE ?? "1") === "1";

export function isQuiet(): boolean { return QUIET_MODE; }

let lastErrorAt = 0;

export type NotifyOpts = { parseMode?: "Markdown" | "MarkdownV2" | "HTML" };

export async function notify(text: string, opts: NotifyOpts = {}): Promise<boolean> {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return false;

  // Telegram caps messages at 4096 chars; truncate below.
  const body = text.length > 3500 ? text.slice(0, 3500) + "\n…(truncated)" : text;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: body,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const now = Date.now();
      if (now - lastErrorAt > 60_000) {
        lastErrorAt = now;
        console.error(`[telegram] send failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      }
      return false;
    }
    return true;
  } catch (err) {
    const now = Date.now();
    if (now - lastErrorAt > 60_000) {
      lastErrorAt = now;
      console.error("[telegram] send error:", (err as Error).message);
    }
    return false;
  }
}

// ── TradeSelect-domain notifiers ─────────────────────────────────────────

type GeneratedCallSummary = {
  total: number;
  ideas: Array<{ code?: string; symbol: string; side: "BUY" | "SELL"; entry?: number; target1?: number; stopLoss?: number; analyst?: string }>;
  regime?: string | null;
};

export async function notifyCallsGenerated(s: GeneratedCallSummary): Promise<boolean> {
  if (s.total === 0) return false;
  // Quiet mode: skip — ideas roll up into morning/EOD briefings instead.
  if (QUIET_MODE) return false;
  const lines = [
    `${TAG} — *${s.total} new ${s.total === 1 ? "call" : "calls"}*${s.regime ? ` · regime ${s.regime}` : ""}`,
    ...s.ideas.slice(0, 10).map((i) =>
      `${i.side === "BUY" ? "🟢" : "🔴"} *${i.symbol}* ${i.side}${i.entry ? ` @ ₹${i.entry}` : ""}${i.target1 ? ` → ₹${i.target1}` : ""}${i.stopLoss ? ` ⛔ ₹${i.stopLoss}` : ""}`,
    ),
  ];
  if (s.ideas.length > 10) lines.push(`… +${s.ideas.length - 10} more`);
  return notify(lines.join("\n"));
}

export type MatchedCall = { symbol: string; outcome: "TARGET_HIT" | "STOP_HIT" | "EXPIRED"; entry?: number; exit?: number; pnlPct?: number };

export async function notifyCallMatched(m: MatchedCall): Promise<boolean> {
  // Quiet mode: skip — target/SL hits roll up into EOD summary.
  if (QUIET_MODE) return false;
  const icon = m.outcome === "TARGET_HIT" ? "🏆" : m.outcome === "STOP_HIT" ? "❌" : "⌛";
  const pl = m.pnlPct != null ? ` (${m.pnlPct >= 0 ? "+" : ""}${m.pnlPct.toFixed(2)}%)` : "";
  return notify(`${TAG} — ${icon} *${m.symbol}* ${m.outcome.replace("_", " ").toLowerCase()}${pl}`);
}

export type OrderEvent = {
  ok: boolean;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price?: number;
  brokerOrderId?: string;
  source?: string;
  error?: string;
  /** When true, this is a real-money order — always notified even in quiet mode. */
  isLive?: boolean;
};

export async function notifyOrder(e: OrderEvent): Promise<boolean> {
  // Quiet mode: only fire for live orders + failed orders. Successful paper
  // placements go silent (rolled into EOD).
  if (QUIET_MODE && !e.isLive && e.ok) return false;
  const liveTag = e.isLive ? "🔴 *LIVE*" : "✅ *Paper*";
  if (e.ok) {
    return notify(
      `${TAG} — ${liveTag} order placed\n${e.side} ${e.qty} ${e.symbol}${e.price ? ` @ ₹${e.price}` : ""}\nBroker order: \`${e.brokerOrderId ?? "?"}\`${e.source ? `\nSource: ${e.source}` : ""}`,
    );
  }
  return notify(
    `${TAG} — ❌ *Order failed* ${e.isLive ? "(LIVE)" : "(paper)"}\n${e.side} ${e.qty} ${e.symbol}\n\`${e.error ?? "unknown"}\``,
  );
}

export type DailySummary = {
  date: string;
  totalCalls: number;
  hits: number;
  misses: number;
  pending: number;
  netPnlPct?: number;
  topWinner?: { symbol: string; pnlPct: number };
  topLoser?: { symbol: string; pnlPct: number };
};

export async function notifyDailySummary(s: DailySummary): Promise<boolean> {
  const winRate = s.totalCalls > 0 ? Math.round((s.hits / Math.max(s.hits + s.misses, 1)) * 100) : 0;
  const lines = [
    `${TAG} — *Daily Summary ${s.date}*`,
    `📊 Calls: ${s.totalCalls} (✅ ${s.hits} target · ❌ ${s.misses} stop · ⌛ ${s.pending} pending)`,
    `Win-rate: *${winRate}%*${s.netPnlPct != null ? ` · Net %: *${s.netPnlPct >= 0 ? "+" : ""}${s.netPnlPct.toFixed(2)}%*` : ""}`,
  ];
  if (s.topWinner) lines.push(`🏆 Best: *${s.topWinner.symbol}* +${s.topWinner.pnlPct.toFixed(2)}%`);
  if (s.topLoser) lines.push(`📉 Worst: *${s.topLoser.symbol}* ${s.topLoser.pnlPct.toFixed(2)}%`);
  return notify(lines.join("\n"));
}

export async function notifyError(context: string, err: unknown): Promise<boolean> {
  const msg = err instanceof Error ? err.message : String(err);
  return notify(`${TAG} — ⚠️ *Error in ${context}*\n\`${msg}\``);
}
