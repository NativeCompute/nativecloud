import { bearer, env, json, rpc, serve, webUrl } from "../_shared/supabase.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const roles: Record<string, string> = { admin: "an admin", member: "a member", guest: "a guest" };

serve(async (req) => {
  const { invite_id } = await req.json().catch(() => ({}));
  if (typeof invite_id !== "string") return json(400, { error: "nc:invalid:invite" });

  const details = await rpc("invite_details", bearer(req), { invite: invite_id });
  if (!details.ok) return json(details.status === 401 ? 401 : 404, { error: "nc:not_found" });
  const invite = await details.json();
  if (invite.state !== "pending") return json(400, { error: "nc:invalid:invite" });

  const key = env("RESEND_API_KEY");
  if (!key) return json(200, { sent: false, reason: "email is not configured" });

  const org = escape(String(invite.org ?? "an organization"));
  const by = escape(String(invite.invited_by ?? "Someone"));
  const link = `${webUrl()}/invite/${encodeURIComponent(String(invite.id))}`;
  const html = `<div style="background:#000;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8e9f0">
<div style="max-width:480px;margin:0 auto;border:1px solid #2a2c38;border-left:2px solid #3b4cff;background:#07080c;padding:28px 32px">
<div style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:1px;color:#8c8fa3">NATIVECLOUD / INVITE</div>
<div style="font-size:24px;font-weight:800;color:#fff;margin-top:12px">Join ${org}</div>
<p style="font-size:14px;line-height:1.55;color:#c5c7d4">${by} invited you to ${org} on NativeCloud as ${escape(roles[String(invite.role)] ?? "a member")}.</p>
<p style="margin:22px 0"><a href="${escape(link)}" style="background:#3b4cff;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:2px;display:inline-block">Accept the invite</a></p>
<p style="font-size:13px;line-height:1.55;color:#8c8fa3">Sign in or create your account with <b>${escape(String(invite.email))}</b>. The invite is open for 14 days.</p>
</div></div>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("INVITE_FROM") || "NativeCloud <cloud@nativecompute.net>",
      to: [invite.email],
      subject: `${invite.invited_by ?? "Someone"} invited you to ${invite.org ?? "an organization"} on NativeCloud`,
      html,
    }),
  });
  return json(sent.ok ? 200 : 502, { sent: sent.ok });
});
