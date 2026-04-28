"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";
import {
  LayoutDashboard, Rocket, Trophy, LineChart, Plug, Briefcase,
  Activity, ListOrdered, BadgeIndianRupee, UserCircle2, Settings, Award,
} from "lucide-react";

const NAV: { href: string; label: string; icon: any; section?: string; badge?: string }[] = [
  { section: "Overview" },
  { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },

  { section: "AlphaPad — Trade Ideas" },
  { href: "/calls",         label: "Trade Ideas",   icon: Rocket },
  { href: "/strategies",    label: "Strategies",    icon: Award },
  { href: "/track-record",  label: "Track Record",  icon: Trophy },

  { section: "BullsAi — Algo Trading" },
  { href: "/algos",         label: "Strategies",    icon: LineChart },
  { href: "/backtest",      label: "Backtest",      icon: Activity },
  { href: "/health",        label: "System health", icon: Activity },

  { section: "Trading" },
  { href: "/broker",        label: "Broker",        icon: Plug, badge: "Paper" },
  { href: "/holdings",      label: "Holdings",      icon: Briefcase },
  { href: "/positions",     label: "Positions",     icon: Activity },
  { href: "/orderbook",     label: "Orderbook",     icon: ListOrdered },

  { section: "Account" },
  { href: "/plans",         label: "Plans & Billing", icon: BadgeIndianRupee },
  { href: "/profile",       label: "Profile",       icon: UserCircle2 },
  { href: "/settings",      label: "Settings",      icon: Settings },
] as any;

export function Sidebar() {
  const pathname = usePathname();
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
          const { href, label, icon: Icon, badge } = item;
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} data-active={active} className="nav-link">
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {badge && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto p-4 text-xs text-muted-foreground border-t">
        Trade With Research Not Opinions
      </div>
    </aside>
  );
}
