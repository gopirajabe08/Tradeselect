// Telegram notifier — single-user push notifications.
// Used by the auto-scheduler for: launches, exits, daily summary, errors.
//
// Requires env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// If either is missing, send() is a no-op (so dev/laptop runs don't crash).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastErrorAt = 0;

export async function notify(text, opts = {}) {
  if (!TOKEN || !CHAT_ID) return false;

  // Telegram messages cap at 4096 chars; truncate well below to leave room
  // for parse mode artifacts.
  const body = text.length > 3500 ? text.slice(0, 3500) + '\n…(truncated)' : text;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: body,
        parse_mode: opts.parseMode ?? 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // Throttle error logs — Telegram outage shouldn't spam our app log.
      const now = Date.now();
      if (now - lastErrorAt > 60_000) {
        lastErrorAt = now;
        console.error(`[telegram] send failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      }
      return false;
    }
    return true;
  } catch (err) {
    const now = Date.now();
    if (now - lastErrorAt > 60_000) {
      lastErrorAt = now;
      console.error('[telegram] send error:', err.message);
    }
    return false;
  }
}

// Convenience helpers — every message tagged so it's distinguishable from
// any future bot we might add to this chat.
const TAG = '🟢 *TradeSelect*';

export async function notifyLaunched(launches) {
  if (!launches.length) return;
  const lines = launches.map((l) => `• ${l.code} → ${l.instrument} (#${l.instanceId})`).join('\n');
  await notify(`${TAG} — *Auto-launched ${launches.length} strategies*\n${lines}`);
}

export async function notifyClosed(closes) {
  if (!closes.length) return;
  const lines = closes.map((c) =>
    `• ${c.code} #${c.instanceId} — ${c.realizedPnl >= 0 ? '✅' : '❌'} ₹${c.realizedPnl.toFixed(2)}`
  ).join('\n');
  await notify(`${TAG} — *EOD: closed ${closes.length} positions*\n${lines}`);
}

export async function notifyDailySummary(summary) {
  // summary: { date, totalRealized, byStrategy: [{code, name, trades, pnl}], topWinner, topLoser }
  const sign = summary.totalRealized >= 0 ? '✅' : '❌';
  const lines = [
    `${TAG} — *Daily Summary ${summary.date}*`,
    `${sign} Net P&L: *₹${summary.totalRealized.toFixed(2)}*`,
    `Strategies run: ${summary.byStrategy.length}`,
    '',
    '*Per strategy:*',
    ...summary.byStrategy.map((s) =>
      `• ${s.code}: ₹${s.pnl.toFixed(2)} (${s.trades} trades)`
    ),
  ];
  if (summary.topWinner) lines.push('', `🏆 Best: ${summary.topWinner.code} ₹${summary.topWinner.pnl.toFixed(2)}`);
  if (summary.topLoser && summary.topLoser !== summary.topWinner) {
    lines.push(`📉 Worst: ${summary.topLoser.code} ₹${summary.topLoser.pnl.toFixed(2)}`);
  }
  await notify(lines.join('\n'));
}

export async function notifyError(context, err) {
  await notify(`${TAG} — ⚠️ *Error in ${context}*\n\`\`\`\n${err.message ?? err}\n\`\`\``);
}
