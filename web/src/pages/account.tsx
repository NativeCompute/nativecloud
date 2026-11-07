import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { Avatar, Block, Button, Empty, Field, Page, Problem, Rules, Skeleton } from "../ui/kit";
import { confirm, fail, fresh, toast } from "../ui/overlay";
import { api, type MyInvite } from "../lib/api";
import { useLoad } from "../lib/load";
import { useSession } from "../lib/session";
import { sb } from "../lib/supabase";
import { ago, emailOk, fileName, passwordOk, passwordRules, planName } from "../lib/format";
import { toError } from "../lib/errors";
import { uniquePaths, zip } from "../lib/zip";

export function InvitesForYou() {
  const { reload } = useSession();
  const { route } = useLocation();
  const list = useLoad(() => api.myInvites(), []);
  if (!list.data?.length) return null;
  const act = async (i: MyInvite, join: boolean) => {
    try {
      if (join) {
        await api.acceptInvite(i.id);
        await reload();
        toast(`You joined ${i.org}.`);
        route(`/o/${i.org_slug}`);
      } else {
        await api.declineInvite(i.id);
        toast("Invite declined.", "info");
        list.reload();
      }
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Block title="Invites for you">
      <ul class="list">
        {list.data.map((i) => (
          <li key={i.id}>
            <span>
              {i.invited_by || "Someone"} invited you to <strong>{i.org}</strong> as {i.role === "admin" ? "an admin" : `a ${i.role}`}.
            </span>
            <span class="actions">
              <Button kind="primary" small onClick={() => act(i, true)}>
                Join
              </Button>
              <Button kind="quiet" small onClick={() => act(i, false)}>
                Decline
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Profile() {
  const { me, reload } = useSession();
  const [name, setName] = useState(me?.display_name ?? "");
  const [hue, setHue] = useState(me?.avatar_hue ?? 0);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const changed = name.trim() !== me.display_name.trim() || hue !== me.avatar_hue;
  return (
    <Block title="Profile">
      <form
        class="stack-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.updateProfile(name.trim(), hue);
            await reload();
            toast("Profile saved. People you write with see the new name.");
          } catch (err) {
            fail(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div class="row">
          <Avatar name={name || me.email} hue={hue} size="lg" />
          <div class="grow">
            <Field id="name" label="Your name">
              <input class="input" id="name" autocomplete="name" maxLength={80} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
        </div>
        <div class="field">
          <span class="hud">Colour</span>
          <div class="swatches" role="group" aria-label="Colour">
            {Array.from({ length: 12 }, (_, k) => k * 30).map((h) => (
              <button key={h} class="swatch" type="button" aria-label={`Hue ${h}`} aria-pressed={Math.floor(hue / 30) * 30 === h} onClick={() => setHue(h)}>
                <Avatar name="" hue={h} size="sm" />
              </button>
            ))}
          </div>
        </div>
        <div class="actions">
          <Button kind="primary" small type="submit" busy={busy} disabled={!changed || !name.trim()}>
            Save profile
          </Button>
        </div>
      </form>
    </Block>
  );
}

function Email() {
  const { me, reload } = useSession();
  const [next, setNext] = useState("");
  const [stage, setStage] = useState<"idle" | "new" | "old">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const start = async (e: Event) => {
    e.preventDefault();
    setError(null);
    const address = next.trim().toLowerCase();
    if (!emailOk(address)) return setError("That doesn't look like an email address.");
    setBusy(true);
    const { error: err } = await sb.auth.updateUser({ email: address });
    setBusy(false);
    if (err) return setError(toError(err).message);
    setStage("new");
  };
  const verify = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const email = stage === "new" ? next.trim().toLowerCase() : me.email;
    const { error: err } = await sb.auth.verifyOtp({ email, token: code, type: "email_change" });
    setBusy(false);
    setCode("");
    if (err) return setError(toError(err).message);
    const user = (await sb.auth.getUser()).data.user;
    if (user?.email?.toLowerCase() === next.trim().toLowerCase()) {
      setStage("idle");
      setNext("");
      await reload();
      toast("Email changed. Use the new one next time you sign in.");
    } else {
      setStage(stage === "new" ? "old" : "new");
    }
  };
  return (
    <Block title="Email">
      {stage === "idle" ? (
        <form class="stack-4" onSubmit={start} noValidate>
          <p class="sec">You sign in with {me.email}. Changing it needs a code from both the old and the new address.</p>
          <Field id="new-email" label="New email" error={error}>
            <input class="input" id="new-email" type="email" autocomplete="email" value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} />
          </Field>
          <div class="actions">
            <Button kind="ghost" small type="submit" busy={busy} disabled={!next.trim()}>
              Change email
            </Button>
          </div>
        </form>
      ) : (
        <form class="stack-4" onSubmit={verify} noValidate>
          <p class="sec">Enter the 6-digit code we sent to {stage === "new" ? next.trim().toLowerCase() : me.email}.</p>
          <Field id="email-code" label="Code" error={error}>
            <input
              class="input otp"
              id="email-code"
              inputMode="numeric"
              autocomplete="one-time-code"
              maxLength={6}
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
            />
          </Field>
          <div class="actions">
            <Button kind="primary" small type="submit" busy={busy} disabled={code.length !== 6}>
              Confirm
            </Button>
            <Button kind="quiet" small onClick={() => setStage("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Block>
  );
}

function Password() {
  const [pw, setPw] = useState("");
  const [nonce, setNonce] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!passwordOk(pw)) return setError("Use at least 10 characters, with upper and lower case letters and a digit.");
    setBusy(true);
    const { error: err } = await sb.auth.updateUser(nonce ? { password: pw, nonce } : { password: pw });
    setBusy(false);
    if (!err) {
      setPw("");
      setNonce(null);
      toast("Password changed. Use it next time you sign in.");
      return;
    }
    const ae = toError(err);
    if (ae.code === "reauthentication_needed" || /reauthenticat/i.test(err.message)) {
      await sb.auth.reauthenticate();
      setNonce("");
      setError("We emailed you a code to confirm it's you. Enter it below.");
      return;
    }
    setError(ae.message);
  };
  return (
    <Block title="Password">
      <form class="stack-4" onSubmit={submit} noValidate>
        <Field id="new-password" label="New password" error={error}>
          <input class="input" id="new-password" type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        </Field>
        {pw ? <Rules rules={passwordRules(pw)} /> : null}
        {nonce !== null ? (
          <Field id="nonce" label="Code from the email">
            <input
              class="input otp"
              id="nonce"
              inputMode="numeric"
              autocomplete="one-time-code"
              maxLength={6}
              value={nonce}
              onInput={(e) => setNonce((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
            />
          </Field>
        ) : null}
        <div class="actions">
          <Button kind="ghost" small type="submit" busy={busy} disabled={!passwordOk(pw) || (nonce !== null && nonce.length !== 6)}>
            Change password
          </Button>
        </div>
      </form>
    </Block>
  );
}

export function Account() {
  const { me } = useSession();
  if (!me) return null;
  return (
    <Page eyebrow="My cloud" title="Account" sub={`${me.email} · ${planName(me.plan.id)} plan`}>
      <InvitesForYou />
      <div class="grid-2">
        <Profile />
        <div class="stack-8">
          <Email />
          <Password />
        </div>
      </div>
    </Page>
  );
}

const platforms: Record<string, string> = { macos: "Mac", windows: "Windows", linux: "Linux", web: "Web" };

export function Computers() {
  const { route } = useLocation();
  const list = useLoad(() => api.devices(), []);
  return (
    <Page
      eyebrow="My cloud"
      title="Computers"
      sub="Every computer an app signed in on. Forgetting one takes it off this list; to stop it syncing, sign out everywhere."
      action={
        <Button
          kind="ghost"
          small
          onClick={async () => {
            const yes = await confirm({
              title: "Sign out on every computer?",
              body: "Every app and browser stops syncing until someone signs in again. Copies on those computers stay.",
              yes: "Sign out everywhere",
              danger: true,
            });
            if (!yes) return;
            await sb.auth.signOut({ scope: "global" });
            route("/sign-in");
          }}
        >
          Sign out everywhere
        </Button>
      }
    >
      {list.error ? <Problem error={list.error} retry={list.reload} /> : null}
      {list.loading && !list.data ? <Skeleton /> : null}
      {list.data && list.data.length === 0 ? <Empty title="No computers yet">Sign in from Blackline or another NativeCompute app and it shows up here.</Empty> : null}
      {list.data && list.data.length > 0 ? (
        <div class="table-wrap">
          <table class="table table--stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>System</th>
                <th>Last seen</th>
                <th class="act">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td data-label="">
                    <strong>{d.name || "A computer"}</strong>
                  </td>
                  <td data-label="System">{platforms[d.platform] ?? d.platform}</td>
                  <td data-label="Last seen">{ago(d.last_seen)}</td>
                  <td class="act" data-label="">
                    <Button
                      kind="quiet"
                      small
                      onClick={async () => {
                        if (!(await confirm({ title: `Forget ${d.name}?`, body: "It disappears from this list. It keeps syncing until you sign out everywhere.", yes: "Forget" })))
                          return;
                        try {
                          await api.forgetDevice(d.id);
                          list.reload();
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      Forget
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  );
}

export async function exportZip(): Promise<{ blob: Blob; count: number }> {
  const [spaces, projects] = await Promise.all([api.allWorkspaces(), api.exportAll()]);
  const folders = projects.map((p) => {
    const w = spaces.find((s) => s.id === p.workspace_id);
    const base = fileName(w ? (w.kind === "personal" ? "My cloud" : w.name) : "Other");
    return p.deleted_at ? `${base}/Recently deleted` : base;
  });
  const paths = uniquePaths(projects.map((p, i) => ({ folder: folders[i] ?? "Other", name: fileName(p.title), ext: p.app_id === "blackline" ? "md" : "txt" })));
  const data = zip(projects.map((p, i) => ({ path: paths[i] ?? `${p.id}.txt`, text: p.body ?? "" })));
  return { blob: new Blob([data], { type: "application/zip" }), count: projects.length };
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function YourData() {
  const { me, signOut } = useSession();
  const { route } = useLocation();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const owned = me.orgs.filter((o) => o.role === "owner");
  return (
    <Page eyebrow="My cloud" title="Your data" sub="Take a copy of everything, or delete your account.">
      <Block title="Export">
        <p class="sec">A zip of every script you can open, one file per script, in a folder per space. Recently deleted scripts are in their own folders.</p>
        <div class="actions">
          <Button
            kind="primary"
            small
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { blob, count } = await exportZip();
                download(blob, `NativeCloud export ${new Date().toISOString().slice(0, 10)}.zip`);
                toast(`Export ready: ${count} ${count === 1 ? "script" : "scripts"}.`);
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Download my data
          </Button>
        </div>
      </Block>
      <section class="danger-zone block" aria-label="Delete account">
        <div class="block-head">
          <h2>Delete account</h2>
        </div>
        <div class="row-action">
          <div class="stack-2">
            <strong>Delete your NativeCloud account</strong>
            <p class="sec">
              My cloud, its snapshots and your settings are deleted now.
              {owned.length
                ? ` ${owned.map((o) => o.name).join(", ")} ${owned.length === 1 ? "passes" : "pass"} to an admin, or a member if there's no admin, or ${owned.length === 1 ? "is" : "are"} deleted if you're alone.`
                : ""}{" "}
              Scripts on your computers stay.
            </p>
          </div>
          <Button
            kind="danger"
            small
            onClick={async () => {
              const yes = await confirm({
                title: "Delete your account?",
                body: "This can't be undone.",
                yes: "Delete account",
                danger: true,
                typed: "DELETE",
              });
              if (!yes) return;
              try {
                const done = await fresh(() => api.deleteAccount());
                if (!done) return;
                await signOut();
                toast("Your account is deleted.", "info");
                route("/sign-in");
              } catch (e) {
                fail(e);
              }
            }}
          >
            Delete account
          </Button>
        </div>
      </section>
    </Page>
  );
}
