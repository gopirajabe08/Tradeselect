import { cn, classForChange, formatPct } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function KpiCard({
  label,
  value,
  sub,
  changePct,
  footer,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  changePct?: number;
  footer?: string;
  accent?: "primary" | "success" | "danger" | "warning";
}) {
  const accentClass =
    accent === "primary" ? "from-primary/20 to-transparent" :
    accent === "success" ? "from-[hsl(var(--success))]/20 to-transparent" :
    accent === "danger"  ? "from-[hsl(var(--danger))]/20 to-transparent" :
    accent === "warning" ? "from-[hsl(var(--warning))]/20 to-transparent" :
    "from-accent/30 to-transparent";
  return (
    <div className={cn("card p-5 bg-gradient-to-br", accentClass)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {typeof changePct === "number" && (
        <div className={cn("mt-2 text-sm font-medium inline-flex items-center gap-1", classForChange(changePct))}>
          {changePct >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          {formatPct(changePct)}
        </div>
      )}
      {footer && <div className="mt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
