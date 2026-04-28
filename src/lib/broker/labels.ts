// Broker-level numeric-code ↔ human-label mappings. Shared across orderbook + modal.

export const ORDER_TYPE_LABEL: Record<number, string> = {
  1: "LIMIT",
  2: "MARKET",
  3: "SL-M",
  4: "SL",
};

export const ORDER_STATUS_OPEN   = new Set<number>([4, 6]); // transit, open
export const ORDER_STATUS_FILLED = 2;

export function orderStatusMeta(s: number): { text: string; cls: string; open: boolean } {
  switch (s) {
    case 1: return { text: "Cancelled", cls: "text-[hsl(var(--danger))]", open: false };
    case 2: return { text: "Filled",    cls: "text-[hsl(var(--success))]", open: false };
    case 3: return { text: "Rejected",  cls: "text-[hsl(var(--danger))]", open: false };
    case 4: return { text: "Transit",   cls: "text-primary", open: true };
    case 5: return { text: "Rejected",  cls: "text-[hsl(var(--danger))]", open: false };
    case 6: return { text: "Open",      cls: "text-primary", open: true };
    default: return { text: `Status ${s}`, cls: "text-muted-foreground", open: false };
  }
}
