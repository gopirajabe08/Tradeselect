/**
 * One-shot cleanup for paper positions whose accounting was corrupted by the
 * pre-2026-05-13 paper-matcher race (no state-write serialization).
 *
 * Symptom this addresses: a position whose internal record is impossible —
 * e.g. NIVABUPA with netQty=-825 but buyQty=0 sellQty=825, meaning a SELL
 * was applied without a corresponding BUY entry. The "phantom" position
 * lingers in state, mark-to-markets fictitious "unrealized" P&L, and
 * blocks tomorrow's L1 auto-tune from acting on honest stats.
 *
 * What this does:
 *   1. Scans positions for impossible bookkeeping:
 *      - netQty < 0 but sellQty > 0 and buyQty < sellQty (phantom short)
 *      - netQty > 0 but buyQty > 0 and sellQty > buyQty (phantom long)
 *   2. For each phantom: zero the position (netQty=0, netAvg=0), release
 *      the cash margin that was reserved against it, and write an audit
 *      entry tagged "reconciliation" so the human trail is preserved.
 *   3. Does NOT attempt to recover lost P&L — that requires full audit
 *      replay (see audit-replay tool, separate). Acknowledges the
 *      irrecoverable accounting state and resets to a known-clean baseline.
 *
 * Run with: npx tsx scripts/cleanup-phantom-positions.ts [--dry]
 */
import { withStateMutation, readState } from "@/lib/broker/paper/store";
import { appendAudit } from "@/lib/broker/audit";

function marginMultiplier(productType: string): number {
  switch (productType) {
    case "MARGIN":
    case "CO":
    case "BO":
    case "INTRADAY": return 0.20;
    case "CNC":
    case "MTF":
    default:         return 1.00;
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const stateBefore = await readState();

  const phantoms = stateBefore.positions.filter(p => {
    if (p.netQty === 0) return false;
    // Phantom short: net is short but the BUY history doesn't justify it
    // (you can't be short more than you've sold-minus-bought).
    if (p.netQty < 0 && p.buyQty + Math.abs(p.netQty) > p.sellQty) return true;
    // Phantom long: similar — net long exceeds buy-minus-sell.
    if (p.netQty > 0 && p.sellQty + p.netQty > p.buyQty) return true;
    // Also flag: any open position with realized=0 BUT buyQty/sellQty != 0
    // (means the close path didn't credit P&L).
    if (p.realized === 0 && (p.buyQty > 0 || p.sellQty > 0) && p.buyQty !== p.sellQty) return true;
    return false;
  });

  if (phantoms.length === 0) {
    console.log("No phantom positions detected. State is consistent.");
    return;
  }

  console.log(`Found ${phantoms.length} phantom position(s):`);
  for (const p of phantoms) {
    const mult = marginMultiplier(p.productType);
    const reservedMargin = Math.abs(p.netQty) * p.netAvg * mult;
    console.log(
      `  ${p.symbol}  netQty=${p.netQty}  netAvg=${p.netAvg}  buyQty=${p.buyQty}  sellQty=${p.sellQty}  realized=${p.realized}  margin-reserved=Rs${reservedMargin.toFixed(0)}`
    );
  }

  if (dry) {
    console.log("--dry: would flatten the above and release reserved margin. Not writing.");
    return;
  }

  await withStateMutation(async (s) => {
    for (const phantom of phantoms) {
      const live = s.positions.find(
        p => p.symbol === phantom.symbol && p.productType === phantom.productType
      );
      if (!live) continue;
      const mult = marginMultiplier(live.productType);
      const reservedMargin = Math.abs(live.netQty) * live.netAvg * mult;
      // Release the reserved margin back to cash. We DO NOT touch realized — the
      // accounting hole is acknowledged, not patched, so future auditors can see
      // the gap and replay if needed.
      s.cash += reservedMargin;
      live.netQty = 0;
      live.netAvg = 0;
      live.closedAt = Date.now();
      live.closedReason = "reconciliation";
    }
  });

  for (const phantom of phantoms) {
    await appendAudit({
      at: new Date().toISOString(),
      broker: "paper",
      action: "auto-follow",
      input: {
        event: "phantom-reconciliation",
        symbol: phantom.symbol,
        productType: phantom.productType,
        priorNetQty: phantom.netQty,
        priorNetAvg: phantom.netAvg,
        priorBuyQty: phantom.buyQty,
        priorSellQty: phantom.sellQty,
        priorRealized: phantom.realized,
      },
      result: "ok",
      resultDetail: {
        source: "reconciliation",
        reason: "pre-2026-05-13 matcher race left position in impossible state; flattened to zero, released reserved margin to cash; realized P&L gap not patched.",
      },
    });
  }

  const stateAfter = await readState();
  console.log("\n=== AFTER CLEANUP ===");
  console.log(`  cash: Rs ${stateAfter.cash.toFixed(0)} (was Rs ${stateBefore.cash.toFixed(0)})`);
  console.log(`  open positions: ${stateAfter.positions.filter(p => p.netQty !== 0).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
