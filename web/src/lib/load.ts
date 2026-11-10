import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type ApiError, toError } from "./errors";

export interface Loaded<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  set: (v: T) => void;
}

interface Held<T> {
  from: unknown;
  data: T | undefined;
  error: ApiError | null;
}

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [held, setHeld] = useState<Held<T>>({ from: null, data: undefined, error: null });
  const [loading, setLoading] = useState(true);
  const turn = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++turn.current;
    setLoading(true);
    try {
      const v = await load();
      if (mine === turn.current) setHeld({ from: reload, data: v, error: null });
    } catch (e) {
      if (mine === turn.current) setHeld((h) => ({ from: reload, data: h.from === reload ? h.data : undefined, error: toError(e) }));
    } finally {
      if (mine === turn.current) setLoading(false);
    }
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  const current = held.from === reload;
  return {
    data: current ? held.data : undefined,
    error: current ? held.error : null,
    loading: loading || !current,
    reload,
    set: (v: T) => setHeld({ from: reload, data: v, error: null }),
  };
}
