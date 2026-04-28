import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "./logout-button";
import { CheckCircle2, ShieldCheck, Landmark, IdCard } from "lucide-react";

export default async function ProfilePage() {
  const user = (await getSession())!;
  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, KYC, and linked services" actions={<LogoutButton />} />

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-header font-medium">Account</div>
          <div className="card-body space-y-3 text-sm">
            <Row label="Name"  value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="User ID" value={user.id} />
            <Row label="Member since" value="Apr 2026" />
          </div>
        </div>

        <div className="card">
          <div className="card-header font-medium">KYC</div>
          <div className="card-body space-y-3 text-sm">
            <StatusRow icon={<IdCard className="h-4 w-4" />} label="Identity (Aadhaar/PAN)" done />
            <StatusRow icon={<Landmark className="h-4 w-4" />} label="Bank account linked" done />
            <StatusRow icon={<ShieldCheck className="h-4 w-4" />} label="Nominee added" />
            <StatusRow icon={<CheckCircle2 className="h-4 w-4" />} label="In-person verification" done />
          </div>
        </div>

        <div className="card">
          <div className="card-header font-medium">Linked accounts</div>
          <div className="card-body space-y-3 text-sm">
            <Row label="Primary bank" value="HDFC Bank · ••••4321" />
            <Row label="Demat" value="NSDL · IN30••••5678" />
            <Row label="Trading account" value="TSEL-100234" />
          </div>
        </div>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatusRow({ icon, label, done }: { icon: React.ReactNode; label: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">{icon}{label}</span>
      {done
        ? <span className="badge-success">Verified</span>
        : <span className="badge-muted">Pending</span>}
    </div>
  );
}
