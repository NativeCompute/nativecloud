import { bearer, errorOf, json, rest, rpc, safeNext, serve, serviceRpc, webUrl } from "../_shared/supabase.ts";

serve(async (req) => {
  const { next } = await req.json().catch(() => ({}));
  const token = bearer(req);
  const who = await rest("/auth/v1/user", token, { method: "GET" });
  if (!who.ok) return json(401, { error: "nc:auth" });
  const user = await who.json();

  const noted = await rpc("note_web_link", token, {});
  if (!noted.ok) return json(noted.status === 401 ? 401 : 400, { error: await errorOf(noted) });

  const made = await serviceRpc("make_grant", { uid: user.id, app: "web", device: "", challenge: null, life: "5 minutes", len: 12 });
  if (!made.ok) return json(400, { error: await errorOf(made) });
  const code = await made.json();
  const path = safeNext(next);
  return json(200, { url: `${webUrl()}/auth/handoff#t=${encodeURIComponent(String(code))}&next=${encodeURIComponent(path)}` });
});
