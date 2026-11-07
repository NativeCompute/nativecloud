import { challengeOf, errorOf, json, serve, serviceRpc, sessionFor } from "../_shared/supabase.ts";

serve(async (req) => {
  const { code, verifier } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || code.length > 32) return json(400, { error: "nc:invalid:code" });
  let challenge: string | null = null;
  if (verifier !== undefined && verifier !== null) {
    if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return json(400, { error: "nc:invalid:verifier" });
    }
    challenge = await challengeOf(verifier);
  }

  const redeemed = await serviceRpc("redeem_app_grant", { code, challenge });
  if (!redeemed.ok) return json(400, { error: await errorOf(redeemed) });
  const grant = await redeemed.json();
  if (grant.error) return json(400, { error: grant.error });
  if (challenge === null && grant.app !== "web") return json(400, { error: "nc:invalid:verifier" });

  const session = await sessionFor(String(grant.email));
  if (!session) return json(500, { error: "nc:server" });
  return json(200, { ...session, app: grant.app, device_name: grant.device_name });
});
