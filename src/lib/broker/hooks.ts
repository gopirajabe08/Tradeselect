"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type BrokerStatus = {
  connected: boolean;
  hasCreds: boolean;
  brokerId?: string;
  userId?: string;
  userName?: string;
  email?: string;
  issuedAt?: number;
  expired?: boolean;
  startingCash?: number;
  cash?: number;
};

export function useBrokerStatus(pollMs = 30_000) {
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/broker/status", { cache: "no-store" });
      const j = await r.json() as BrokerStatus;
      if (!mounted.current) return;
      setStatus(j); setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => { mounted.current = false; clearInterval(t); };
  }, [refresh, pollMs]);

  return { status, loading, error, refresh };
}

export function useBrokerResource<T>(path: string, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(path, { cache: "no-store" });
      setStatus(r.status);
      const j = await r.json();
      if (!mounted.current) return;
      if (!r.ok) {
        setError(j?.error ?? `HTTP ${r.status}`);
        setData(null);
      } else {
        setError(null);
        setData(j as T);
        setLastUpdated(Date.now());
      }
    } catch (e) {
      if (!mounted.current) return;
      setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    if (pollMs > 0) {
      const t = setInterval(refresh, pollMs);
      return () => { mounted.current = false; clearInterval(t); };
    }
    return () => { mounted.current = false; };
  }, [refresh, pollMs]);

  return { data, loading, error, status, lastUpdated, refresh };
}
