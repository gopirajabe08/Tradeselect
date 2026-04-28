import { NextResponse } from "next/server";
import { createSession, verifyCredentials } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "missing" }, { status: 400 });
  const user = await verifyCredentials(email, password);
  if (!user) return NextResponse.json({ error: "invalid" }, { status: 401 });
  await createSession(user);
  return NextResponse.json({ ok: true, user });
}
