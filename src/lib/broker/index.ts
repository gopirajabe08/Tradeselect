import type { BrokerAdapter, BrokerId } from "./adapter";
import { FyersBroker, BrokerNotConnectedError, BrokerApiError } from "./fyers";
import { TradejiniBroker } from "./tradejini";
import { PaperBroker } from "./paper/engine";
import { readMode } from "./mode";

export { BrokerNotConnectedError, BrokerApiError };
export type { BrokerId, BrokerAdapter };
export { readMode, writeMode } from "./mode";

/** Adapter registry. Add new brokers here (upstox, dhan, etc). */
export const ADAPTERS: Record<BrokerId, BrokerAdapter> = {
  paper:     PaperBroker as unknown as BrokerAdapter,
  fyers:     FyersBroker as unknown as BrokerAdapter,
  tradejini: TradejiniBroker,
};

export const BROKER_LIST: { id: BrokerId; displayName: string; supportsOAuth: boolean }[] = [
  { id: "paper",     displayName: "Paper",     supportsOAuth: false },
  { id: "fyers",     displayName: "Fyers",     supportsOAuth: true },
  { id: "tradejini", displayName: "Tradejini", supportsOAuth: true },
];

/** Resolves the currently active broker adapter based on runtime config. */
export async function activeBroker(): Promise<BrokerAdapter> {
  const mode = await readMode();
  return ADAPTERS[mode] ?? ADAPTERS.paper;
}

/**
 * Sync proxy used by routes that expect the old synchronous `Broker` import.
 * Internally routes that call Broker.x() should prefer `(await activeBroker()).x()`.
 */
export const Broker: BrokerAdapter = new Proxy({} as BrokerAdapter, {
  get(_t, prop) {
    return async (...args: unknown[]) => {
      const real = await activeBroker();
      const fn = (real as any)[prop];
      if (typeof fn !== "function") throw new Error(`Broker.${String(prop)} is not a function on ${real.id}`);
      return fn.apply(real, args);
    };
  },
});
