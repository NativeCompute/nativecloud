import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type ApiError, toError } from "./errors";

export interface Loaded<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  set: (v: T) => void;
}

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const turn = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++turn.current;
    setLoading(true);
    try {
      const v = await load();
      if (mine === turn.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (mine === turn.current) setError(toError(e));
    } finally {
      if (mine === turn.current) setLoading(false);
    }
  }, deps);
  useEffect(() => {
    setData(undefined);
    reload();
  }, [reload]);
  return { data, error, loading, reload, set: setData };
}
