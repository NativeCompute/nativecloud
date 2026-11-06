import { bearer, claims, env, json, rest, serviceRpc } from "../_shared/supabase.ts";

const FRESH_SECONDS = 600;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "nc:method" });
  const token = bearer(req);

  const who = await rest("/auth/v1/user", token, { method: "GET" });
  if (!who.ok) return json(401, { error: "nc:auth" });
  const user = await who.json();

  const issued = Number(claims(token).iat ?? 0);
  if (!issued || Date.now() / 1000 - issued > FRESH_SECONDS) {
    return json(403, { error: "nc:reauth" });
  }

  const prepared = await serviceRpc("prepare_account_deletion", { uid: user.id });
  if (!prepared.ok) return json(500, { error: "nc:server" });
  const summary = await prepared.json();

  const removed = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
  });
  if (!removed.ok) return json(500, { error: "nc:server" });
  return json(200, { deleted: true, teams: summary });
});
