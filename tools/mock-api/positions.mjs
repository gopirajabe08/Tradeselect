// Position lifecycle helpers — extracted out of simulator.mjs so state.mjs
// can call them without a circular import + dynamic-import race.
//
// closePositionWithCosts is the single canonical path that:
//   1. Computes gross P&L from quoted prices
//   2. Subtracts SELL-leg + entry-leg costs
//   3. Pushes a SELL trade with full schema
//   4. Mutates instance: clears position, accumulates realizedPnl
//
// Used by:
//   - simulator.mjs   tick loop (window-close auto-exit, strategy SELL)
//   - state.mjs       stopInstance (user-stop)
//   - auto-scheduler  EOD cleanup

import { legCosts } from './costs.mjs';

const MAX_TRADES = 5000;

export function pushTrade(state, { instanceId, instrument, side, price, quantity, reason, pnl, costs, grossPnl = 0 }) {
  const fillPrice = costs?.fillPrice ?? Number(price.toFixed(2));
  const trade = {
    id: state.nextTradeId++,
    instanceId,
    instrument,
    side,
    price: Number(price.toFixed(2)),
    fillPrice,
    quantity,
    value: Number((fillPrice * quantity).toFixed(2)),
    pnl: Number(pnl.toFixed(2)),
    grossPnl: Number(grossPnl.toFixed(2)),
    costs: costs ? {
      brokerage: costs.brokerage,
      stt: costs.stt,
      exchangeTxn: costs.exchangeTxn,
      sebi: costs.sebi,
      stampDuty: costs.stampDuty,
      gst: costs.gst,
      slippage: costs.slippage,
      total: costs.total,
    } : null,
    reason,
    timestamp: new Date().toISOString(),
  };
  state.trades.push(trade);
  if (state.trades.length > MAX_TRADES) {
    state.trades.splice(0, state.trades.length - MAX_TRADES);
  }
  return trade;
}

export function closePositionWithCosts(state, inst, price, reason) {
  // Defensive: caller may have a stale view of inst.position. If a concurrent
  // tick already cleared it, return null so caller can move on.
  if (!inst.position) return null;

  const grossPnl = (price - inst.position.entryPrice) * inst.position.quantity;
  const sellCosts = legCosts('SELL', price, inst.position.quantity);
  const entryCost = inst.position.entryCost ?? 0;
  const netRoundTrip = Number((grossPnl - sellCosts.total - entryCost).toFixed(2));

  const trade = pushTrade(state, {
    instanceId: inst.id,
    instrument: inst.instrument,
    side: 'SELL',
    price,
    quantity: inst.position.quantity,
    reason,
    pnl: netRoundTrip,
    grossPnl,
    costs: sellCosts,
  });

  inst.tradeIds.push(trade.id);
  inst.realizedPnl = Number((inst.realizedPnl + netRoundTrip).toFixed(2));
  inst.position = null;
  inst.unrealizedPnl = 0;
  return trade;
}
