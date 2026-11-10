import { bearer, env, errorOf, json, rpc, serve, serviceRpc } from "../_shared/supabase.ts";

serve(async (req) => {
  const token = bearer(req);
  const { user_id } = await req.json().catch(() => ({}));
  if (typeof user_id !== "string" || !/^[0-9a-f-]{36}$/.test(user_id)) return json(400, { error: "nc:invalid:member" });

  const noted = await rpc("staff_record_deletion", token, { uid: user_id });
  if (!noted.ok) return json(noted.status === 401 ? 401 : 400, { error: await errorOf(noted) });

  const prepared = await serviceRpc("prepare_account_deletion", { uid: user_id });
  if (!prepared.ok) return json(500, { error: "nc:server" });
  const summary = await prepared.json();

  const removed = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users/${user_id}`, {
    method: "DELETE",
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` },
  });
  if (!removed.ok) return json(500, { error: "nc:server" });
  return json(200, { deleted: true, orgs: summary });
});
