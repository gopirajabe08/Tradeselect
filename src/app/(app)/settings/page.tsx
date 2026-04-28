"use client";
import { PageHeader } from "@/components/page-header";
import { useState } from "react";

export default function SettingsPage() {
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifPush, setNotifPush] = useState(false);
  const [notifSms, setNotifSms] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [defaultList, setDefaultList] = useState("Large Caps");
  const [currency] = useState("INR");

  return (
    <>
      <PageHeader title="Settings" subtitle="Notifications, security, and preferences" />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header font-medium">Notifications</div>
          <div className="card-body space-y-3 text-sm">
            <Toggle label="Email updates (order confirmations, reports)" checked={notifEmail} onChange={setNotifEmail} />
            <Toggle label="Push notifications" checked={notifPush} onChange={setNotifPush} />
            <Toggle label="SMS for critical alerts" checked={notifSms} onChange={setNotifSms} />
          </div>
        </div>

        <div className="card">
          <div className="card-header font-medium">Security</div>
          <div className="card-body space-y-3 text-sm">
            <Toggle label="Two-factor authentication (TOTP)" checked={twoFA} onChange={setTwoFA} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active sessions</span>
              <span className="badge-muted">1 device</span>
            </div>
            <button className="btn-outline">Change password</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header font-medium">Preferences</div>
          <div className="card-body space-y-3 text-sm">
            <label className="block">
              <span className="text-muted-foreground">Default watchlist</span>
              <select className="input mt-1" value={defaultList} onChange={(e) => setDefaultList(e.target.value)}>
                <option>Large Caps</option>
                <option>IT Basket</option>
                <option>ETFs</option>
              </select>
            </label>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Display currency</span>
              <span>{currency}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header font-medium">Data & privacy</div>
          <div className="card-body space-y-3 text-sm">
            <button className="btn-outline w-full justify-start">Download account data</button>
            <button className="btn-outline w-full justify-start">Export trade history (CSV)</button>
            <button className="btn-outline w-full justify-start text-[hsl(var(--danger))]">Deactivate account</button>
          </div>
        </div>
      </section>
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span>{label}</span>
      <span
        role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={"inline-flex h-5 w-9 rounded-full transition " + (checked ? "bg-primary" : "bg-muted")}
      >
        <span className={"h-4 w-4 bg-white rounded-full shadow transform transition my-0.5 " + (checked ? "translate-x-4" : "translate-x-1")} />
      </span>
    </label>
  );
}
