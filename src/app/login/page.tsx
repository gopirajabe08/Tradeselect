import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

// `useSearchParams()` inside LoginForm needs a Suspense boundary to allow
// Next.js to statically prerender this page while the search-params reads
// happen client-side. Without this the build fails on /login prerender.
export default function LoginPage() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-primary/10 via-background to-background">
        <Logo />
        <div className="space-y-3 max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight">
            Trade with research, not opinions.
          </h1>
          <p className="text-muted-foreground">
            TradeSelect pairs SEBI-registered trade ideas (AlphaPad) with AI-powered algo trading (BullsAi) —
            entry, target and stop-loss for every call, backtested strategies for every setup.
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 pt-2">
            <li>• Buy/Sell ideas across Equity, Intraday, Swing, BTST, F&amp;O and MCX</li>
            <li>• Backtested algo strategies with Paper and Live execution</li>
            <li>• Transparent track record, real-time alerts</li>
          </ul>
        </div>
        <div className="text-xs text-muted-foreground">Demo build · Mock data · Not investment advice</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden"><Logo /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Use the demo credentials below to explore.</p>
          </div>
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
            <LoginForm />
          </Suspense>
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">Demo credentials</div>
            Email: <code>demo@tradeselect.app</code><br />
            Password: <code>demo1234</code>
          </div>
        </div>
      </div>
    </div>
  );
}
