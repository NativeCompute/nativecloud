import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
export const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const sb = createClient(SUPABASE_URL || "http://127.0.0.1:54321", ANON_KEY || "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "nativecloud-session" },
});
