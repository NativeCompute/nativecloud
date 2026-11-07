import { bearer, errorOf, json, rest, safeNext, serve, serviceRpc, webUrl } from "../_shared/supabase.ts";

serve(async (req) => {
  const { next } = await req.json().catch(() => ({}));
  const who = await rest("/auth/v1/user", bearer(req), { method: "GET" });
  if (!who.ok) return json(401, { error: "nc:auth" });
  const user = await who.json();

  const made = await serviceRpc("make_grant", { uid: user.id, app: "web", device: "", challenge: null, life: "5 minutes" });
  if (!made.ok) return json(400, { error: await errorOf(made) });
  const code = await made.json();
  const path = safeNext(next);
  return json(200, { url: `${webUrl()}/auth/handoff#t=${encodeURIComponent(String(code))}&next=${encodeURIComponent(path)}` });
});
