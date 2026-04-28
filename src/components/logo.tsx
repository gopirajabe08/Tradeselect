import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
        TS
      </div>
      <div className="font-semibold tracking-tight text-lg">TradeSelect</div>
    </div>
  );
}
