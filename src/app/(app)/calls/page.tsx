import { PageHeader } from "@/components/page-header";
import { PublishIdeaButton } from "@/components/publish-idea-button";
import { readCalls } from "@/lib/calls/store";
import { triggerCallMatcher } from "@/lib/calls/matcher";
import { CallsView } from "./calls-view";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams?: { segment?: string; status?: string };
}) {
  triggerCallMatcher();                           // background status refresh
  const calls = await readCalls();

  return (
    <>
      <PageHeader
        title="Trade Ideas"
        subtitle="Published buy/sell ideas across Equity, F&O and MCX — with entry, targets and stop-loss."
        actions={<PublishIdeaButton />}
      />
      <CallsView
        calls={calls}
        initialSegment={searchParams?.segment ?? "All"}
        initialStatus={searchParams?.status ?? "All"}
      />
    </>
  );
}
