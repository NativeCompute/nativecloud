import type { Session } from "@supabase/supabase-js";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { api, type Me } from "./api";
import { ApiError, toError } from "./errors";
import { sb } from "./supabase";

export interface SessionState {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  problem: ApiError | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({
  ready: false,
  session: null,
  me: null,
  problem: null,
  reload: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<ApiError | null>(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
    });
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id ?? "";

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      setMe(await api.me());
      setProblem(null);
    } catch (e) {
      setProblem(toError(e));
    }
  }, [uid]);

  useEffect(() => {
    setMe(null);
    setProblem(null);
    if (uid) reload();
  }, [uid]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut({ scope: "local" });
    setMe(null);
  }, []);

  const ready = loaded && (!session || me !== null || problem !== null);
  return <Ctx.Provider value={{ ready, session, me, problem, reload, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
