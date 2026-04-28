// Next.js hook that fires once on server boot (Node runtime only).
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/calls/scheduler");
    startScheduler();
  }
}
