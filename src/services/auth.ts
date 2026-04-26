export type AuthUser = {
  name: string;
  mobile: string;
  countryCode: string;
  email: string;
};

type Credential = {
  countryCode: string;
  mobile: string;
  password: string;
  user: AuthUser;
};

const STORAGE_KEY = 'tradeselect_user';

export const DEMO_CREDENTIALS: Credential[] = [
  {
    countryCode: '+91',
    mobile: '9999999999',
    password: 'demo123',
    user: {
      name: 'Demo Trader',
      mobile: '9999999999',
      countryCode: '+91',
      email: 'demo.in@tradeselect.local',
    },
  },
  {
    countryCode: '+1',
    mobile: '5551234567',
    password: 'demo123',
    user: {
      name: 'US Trader',
      mobile: '5551234567',
      countryCode: '+1',
      email: 'demo.us@tradeselect.local',
    },
  },
];

export function getCurrentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function login(input: {
  countryCode: string;
  mobile: string;
  password: string;
}): Promise<AuthUser> {
  await new Promise((r) => setTimeout(r, 350));
  const match = DEMO_CREDENTIALS.find(
    (c) =>
      c.countryCode === input.countryCode &&
      c.mobile === input.mobile &&
      c.password === input.password,
  );
  if (!match) {
    throw new Error('Invalid mobile number or password.');
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(match.user));
  return match.user;
}

export function logout(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
