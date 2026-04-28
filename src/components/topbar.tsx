"use client";
import { Bell, Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { BrokerStatusBadge } from "./broker-status-badge";
import Link from "next/link";

export function Topbar({ userName }: { userName: string }) {
  return (
    <header className="h-16 border-b bg-card/60 backdrop-blur flex items-center px-4 gap-3 sticky top-0 z-10">
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          className="input pl-9"
          placeholder="Search ideas, strategies, symbols…"
        />
      </div>
      <div className="flex items-center gap-2">
        <BrokerStatusBadge />
        <ThemeToggle />
        <button className="btn-ghost" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </button>
        <Link href="/profile" className="flex items-center gap-2 ml-2">
          <div className="h-8 w-8 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold">
            {userName.split(" ").map(s => s[0]).slice(0,2).join("")}
          </div>
          <div className="text-sm hidden sm:block">
            <div className="font-medium leading-tight">{userName}</div>
            <div className="text-xs text-muted-foreground leading-tight">Account</div>
          </div>
        </Link>
      </div>
    </header>
  );
}
