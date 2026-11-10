import { bearer, errorOf, json, rest, serve, serviceRpc, env, webUrl } from "../_shared/supabase.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const roles: Record<string, string> = { admin: "an admin", member: "a member", guest: "a guest" };

serve(async (req) => {
  const { invite_id } = await req.json().catch(() => ({}));
  if (typeof invite_id !== "string" || !/^[0-9a-f-]{36}$/.test(invite_id)) return json(400, { error: "nc:invalid:invite" });

  const who = await rest("/auth/v1/user", bearer(req), { method: "GET" });
  if (!who.ok) return json(401, { error: "nc:auth" });
  const user = await who.json();

  const key = env("RESEND_API_KEY");
  if (!key) return json(200, { sent: false, reason: "email is not configured" });

  const claimed = await serviceRpc("claim_invite_send", { invite: invite_id, sender: user.id });
  if (!claimed.ok) return json(claimed.status === 429 ? 429 : 400, { error: await errorOf(claimed) });
  const invite = await claimed.json();

  const org = escape(String(invite.org ?? "an organization").slice(0, 80));
  const by = escape(String(invite.invited_by ?? "someone"));
  const link = `${webUrl()}/invite/${encodeURIComponent(String(invite.id))}`;
  const html = `<div style="background:#000;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8e9f0">
<div style="max-width:480px;margin:0 auto;border:1px solid #2a2c38;border-left:2px solid #3b4cff;background:#07080c;padding:28px 32px">
<div style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:1px;color:#8c8fa3">NATIVECLOUD / INVITE</div>
<div style="font-size:24px;font-weight:800;color:#fff;margin-top:12px">You're invited to NativeCloud</div>
<p style="font-size:14px;line-height:1.55;color:#c5c7d4"><b>${by}</b> invited you to join the organization &ldquo;${org}&rdquo; as ${escape(roles[String(invite.role)] ?? "a member")}.</p>
<p style="margin:22px 0"><a href="${escape(link)}" style="background:#3b4cff;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:2px;display:inline-block">Open the invite</a></p>
<p style="font-size:13px;line-height:1.55;color:#8c8fa3">Sign in or create your account with <b>${escape(String(invite.email))}</b>. The invite is open for 14 days. If you don't know the sender, ignore this email.</p>
</div></div>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("INVITE_FROM") || "NativeCloud <cloud@nativecompute.net>",
      to: [invite.email],
      subject: "You're invited to NativeCloud",
      html,
    }),
  });
  return json(sent.ok ? 200 : 502, { sent: sent.ok });
});
