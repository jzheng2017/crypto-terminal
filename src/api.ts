import { useCallback, useEffect, useState } from 'react';
import type { Envelope } from './types';

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}
export function useApi<T>(path: string | null, poll = 0) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ result: Envelope<T> | null; loading: boolean; error: string }>({
    result: null,
    loading: Boolean(path),
    error: '',
  });
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setState({ result: null, loading: Boolean(path), error: '' });
    if (!path)
      return () => {
        active = false;
        controller.abort();
      };
    const load = async () => {
      try {
        const result = await getJson<Envelope<T>>(path, controller.signal);
        if (active) setState({ result, loading: false, error: '' });
      } catch (error) {
        if (active)
          setState((previous) => ({
            result: previous.result ? { ...previous.result, stale: true } : null,
            loading: false,
            error: error instanceof Error ? error.message : 'Data unavailable.',
          }));
      } finally {
        if (active && poll) timer = setTimeout(load, poll);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, poll, version]);
  return { ...state, refresh };
}
