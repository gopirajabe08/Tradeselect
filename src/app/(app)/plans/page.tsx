import { PageHeader } from "@/components/page-header";
import { plans } from "@/lib/mock/seed";
import { formatINR } from "@/lib/utils";
import { Check, Sparkles } from "lucide-react";

const CADENCE_LABEL: Record<"month" | "quarter" | "year", string> = {
  month: "/month", quarter: "/quarter", year: "/year",
};

export default function PlansPage() {
  return (
    <>
      <PageHeader
        title="Plans & Billing"
        subtitle="Trade with research, not opinions. Pick a plan that matches your cadence."
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(p => {
          const popular = p.tag === "Most Popular";
          return (
            <div
              key={p.id}
              className={
                "card relative " +
                (popular ? "border-primary ring-1 ring-primary" : "")
              }
            >
              {popular && (
                <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full">
                  <Sparkles className="h-3 w-3" />
                  Most Popular
                </span>
              )}
              <div className="card-body space-y-4">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-2">
                    <span className="text-3xl font-semibold tracking-tight">
                      {formatINR(p.price, { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-sm text-muted-foreground">{CADENCE_LABEL[p.cadence]}</span>
                  </div>
                </div>

                <ul className="space-y-1.5 text-sm">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button className={popular ? "btn-primary w-full" : "btn-outline w-full"}>
                  {popular ? "Choose Quarterly" : `Choose ${p.name.replace("Premium ", "")}`}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="card-header font-medium">What&apos;s included in every plan</div>
        <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8 text-sm">
          {[
            "SEBI-registered Buy/Sell/Hold calls",
            "Real-time alerts (app + email + SMS)",
            "Access to AlphaPad research community",
            "BullsAi Strategy Vault access",
            "Paper trading sandbox",
            "Historical track record transparency",
            "Secure single sign-on",
            "Cancel anytime",
          ].map(f => (
            <div key={f} className="flex items-start gap-2">
              <Check className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5" />
              <span>{f}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        All figures inclusive of GST where applicable. TradeSelect is a research and algo-execution platform. We do not handle
        broker funds — trades execute on your linked broker. Past performance does not guarantee future returns.
      </p>
    </>
  );
}
