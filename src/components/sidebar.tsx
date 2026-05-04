"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";
import { useBrokerStatus } from "@/lib/broker/hooks";
import {
  LayoutDashboard, Rocket, Trophy, LineChart, Plug, Briefcase,
  Activity, ListOrdered, UserCircle2, Settings, Award,
} from "lucide-react";

// Single brand: TradeSelect. Sub-brands (AlphaPad, BullsAi) dropped per UI audit 2026-05-04 —
// three brand names for a personal app = noise.
const NAV: { href: string; label: string; icon: any; section?: string; brokerBadge?: boolean }[] = [
  { section: "Overview" },
  { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },

  { section: "Ideas" },
  { href: "/calls",         label: "Trade Ideas",   icon: Rocket },
  { href: "/strategies",    label: "Strategies",    icon: Award },
  { href: "/track-record",  label: "Track Record",  icon: Trophy },

  { section: "Algos" },
  { href: "/algos",         label: "Live algos",    icon: LineChart },
  { href: "/backtest",      label: "Backtest",      icon: Activity },
  { href: "/health",        label: "System health", icon: Activity },

  { section: "Trading" },
  { href: "/broker",        label: "Broker",        icon: Plug, brokerBadge: true },
  { href: "/holdings",      label: "Holdings",      icon: Briefcase },
  { href: "/positions",     label: "Positions",     icon: Activity },
  { href: "/orderbook",     label: "Orderbook",     icon: ListOrdered },

  { section: "Account" },
  { href: "/profile",       label: "Profile",       icon: UserCircle2 },
  { href: "/settings",      label: "Settings",      icon: Settings },
] as any;

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useBrokerStatus(15_000);
  const isPaper = !status || status.brokerId === "paper";
  const modeLabel = isPaper ? "Paper" : "LIVE";
  const modeClass = isPaper
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
    : "bg-red-600 text-white border border-red-700";

  return (
    <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r bg-card">
      <div className="h-16 px-5 flex items-center border-b">
        <Logo />
      </div>
      <nav className="p-3 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map((item, idx) => {
          if (item.section) {
            return (
              <div key={"s-" + idx} className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {item.section}
              </div>
            );
          }
          const { href, label, icon: Icon, brokerBadge } = item;
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} data-active={active} className="nav-link">
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {brokerBadge && (
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${modeClass}`}>
                  {modeLabel}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto p-4 text-xs text-muted-foreground border-t">
        TradeSelect · {isPaper ? "Paper mode" : "LIVE — real money"}
      </div>
    </aside>
  );
}
