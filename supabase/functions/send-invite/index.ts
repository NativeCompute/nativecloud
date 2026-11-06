import { bearer, env, json, rpc } from "../_shared/supabase.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "nc:method" });
  const token = bearer(req);
  const { invite_id, app } = await req.json().catch(() => ({}));
  if (typeof invite_id !== "string") return json(400, { error: "nc:invalid:invite" });

  const details = await rpc("invite_details", token, { invite: invite_id });
  if (!details.ok) return json(details.status, { error: "nc:not_found" });
  const invite = await details.json();

  const key = env("RESEND_API_KEY");
  if (!key) return json(200, { sent: false, reason: "email is not configured" });

  const appName = typeof app === "string" && app.length < 40 ? app : "a NativeCompute app";
  const team = escape(String(invite.workspace ?? "a team"));
  const by = escape(String(invite.invited_by ?? "Someone"));
  const html = `<div style="background:#000;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8e9f0">
<div style="max-width:480px;margin:0 auto;border:1px solid #2a2c38;border-left:2px solid #3b4cff;background:#07080c;padding:28px 32px">
<div style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:1px;color:#8c8fa3">NATIVECLOUD / INVITE</div>
<div style="font-size:24px;font-weight:800;color:#fff;margin-top:12px">Join ${team}</div>
<p style="font-size:14px;line-height:1.55;color:#c5c7d4">${by} invited you to work together in ${escape(appName)} as ${escape(String(invite.role))}.</p>
<p style="font-size:14px;line-height:1.55;color:#c5c7d4">Open the app and sign in, or create a NativeCloud account, with <b>${escape(String(invite.email))}</b>. The invite waits for you there for 14 days.</p>
</div></div>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("INVITE_FROM") || "NativeCloud <cloud@nativecompute.net>",
      to: [invite.email],
      subject: `${invite.invited_by ?? "Someone"} invited you to ${invite.workspace ?? "a team"}`,
      html,
    }),
  });
  return json(sent.ok ? 200 : 502, { sent: sent.ok });
});
