import type { AuthUser } from '@/services/auth';

export default function access(initialState: { currentUser?: AuthUser | null } | undefined) {
  return {
    canUser: !!initialState?.currentUser,
  };
}
