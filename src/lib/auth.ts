import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Lazy secret resolution: assert at first runtime use, not at module load.
// (next build evaluates modules with NODE_ENV=production, so a top-level
// throw would break the build itself.)
function getSecret(): Uint8Array {
  const fromEnv = process.env.SESSION_SECRET;
  // Skip the assert during `next build` (NEXT_PHASE === phase-production-build)
  // because static pre-rendering evaluates pages with no runtime env.
  const isBuilding = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuilding && !fromEnv) {
    throw new Error("SESSION_SECRET env var must be set in production");
  }
  return new TextEncoder().encode(fromEnv || "dev-secret-change-me-dev-secret-change-me");
}
const COOKIE = "ts_session";

export type SessionUser = { id: string; email: string; name: string };

// Mock user store. In production this becomes a DB call.
const USERS = [
  { id: "u-1", email: "demo@tradeselect.app", password: "demo1234", name: "Demo Investor" },
];

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const u = USERS.find((x) => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
  return u ? { id: u.id, email: u.email, name: u.name } : null;
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { id: String(payload.id), email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}
