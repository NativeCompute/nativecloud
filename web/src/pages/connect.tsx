import { useEffect, useState } from "preact/hooks";
import type { Session } from "@supabase/supabase-js";
import { useLocation, useRoute } from "preact-iso";
import { AuthLayout } from "../ui/auth";
import { Button, Skeleton } from "../ui/kit";
import { api, type InviteDetails } from "../lib/api";
import { useSession } from "../lib/session";
import { appRequest, handoff, loopback, query, withNext, type AppRequest } from "../lib/nav";
import { grantCode } from "../lib/format";
import { toError, type ApiError } from "../lib/errors";
import { fail, fresh, toast } from "../ui/overlay";

const remembered = (state: string): string | null => {
  try {
    return sessionStorage.getItem(`nativecloud-grant-${state}`);
  } catch {
    return null;
  }
};

const remember = (state: string, code: string) => {
  try {
    sessionStorage.setItem(`nativecloud-grant-${state}`, code);
  } catch {
    return;
  }
};

export function AppLogin() {
  const { session, me, ready, signOut } = useSession();
  const { route, url } = useLocation();
  const [req] = useState<AppRequest | null>(() => appRequest(query()));
  const [appName, setAppName] = useState("");
  const [code, setCode] = useState<string | null>(() => (req ? remembered(req.state) : null));
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    if (!req || !ready || session) return;
    route(withNext(req.signup ? "/sign-up" : "/sign-in", url), true);
  }, [ready, session]);

  useEffect(() => {
    if (!req) return;
    api
      .apps()
      .then((list) => setAppName(list.find((a) => a.id === req.app)?.name ?? ""))
      .catch(() => setAppName(""));
  }, []);

  if (!req) {
    return (
      <AuthLayout title="This link is broken" eyebrow="NativeCloud / Sign in to an app">
        <p class="sec">It's missing something the app needs. Go back to the app and choose Sign in again.</p>
        <a class="btn btn--ghost" href="/">
          Open NativeCloud
        </a>
      </AuthLayout>
    );
  }
  const name = appName || req.app.charAt(0).toUpperCase() + req.app.slice(1);
  if (!ready || !session || !me) {
    return (
      <AuthLayout title={`Sign in to ${name}`} eyebrow="NativeCloud / Sign in to an app">
        <Skeleton rows={2} />
      </AuthLayout>
    );
  }
  const go = (params: Record<string, string>) => {
    window.location.assign(loopback(req, params));
  };
  const allow = async () => {
    setBusy(true);
    try {
      const c = await fresh(() => api.createAppGrant(req.app, req.device, req.challenge));
      if (c === undefined) return;
      remember(req.state, c);
      setCode(c);
      setTimeout(() => go({ code: c }), 250);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (code) {
    return (
      <AuthLayout title={`Back to ${name}`} eyebrow="NativeCloud / Sign in to an app">
        <p class="sec">
          Your browser is handing you back to {name}, signed in as <strong>{me.email}</strong>.
        </p>
        {showCode ? (
          <>
            <p class="sec">Type this code into {name} on this computer. Never give it to anyone or type it into a website: it signs in as you.</p>
            <div class="code-box" aria-label="Sign-in code">
              {grantCode(code)}
            </div>
            <p class="hud">It works once, for two minutes</p>
          </>
        ) : (
          <Button kind="ghost" small onClick={() => setShowCode(true)}>
            {name} didn't open
          </Button>
        )}
        <div class="actions">
          <Button kind="ghost" small onClick={() => go({ code })}>
            Try again
          </Button>
          <a class="btn btn--quiet btn--sm" href="/">
            Open NativeCloud
          </a>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={`Sign in to ${name}?`} eyebrow="NativeCloud / Sign in to an app">
      <div class="app-ask">
        <span class="mark" aria-hidden="true">
          {name.charAt(0)}
        </span>
        <p>
          <strong>{name}</strong>
          {req.device ? (
            <>
              {" "}
              on <strong>{req.device}</strong>
            </>
          ) : null}{" "}
          wants to use your NativeCloud account, <strong>{me.email}</strong>.
        </p>
      </div>
      <p class="sec">
        It can do what you can do in NativeCloud: open, write and sync your scripts, and manage your organizations. Only continue if you just chose Sign in in {name} on this computer.
      </p>
      <div class="stack-2">
        <Button kind="primary" block busy={busy} onClick={allow}>
          Continue
        </Button>
        <Button kind="ghost" block onClick={() => go({ error: "cancelled" })}>
          Cancel
        </Button>
      </div>
      <button
        class="btn btn--quiet btn--sm"
        type="button"
        onClick={async () => {
          await signOut();
          route(withNext("/sign-in", url), true);
        }}
      >
        Not you? Use another account
      </button>
    </AuthLayout>
  );
}

export function Handoff() {
  const { route } = useLocation();
  const { session } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [next, setNext] = useState("/");
  const [pending, setPending] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (s: Session, to: string) => {
    setBusy(true);
    try {
      await api.useHandoff(s);
      route(to, true);
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const h = handoff(window.location.hash);
    history.replaceState(null, "", window.location.pathname);
    if (!h) {
      setError(toError({ message: "nc:invalid:code" }));
      return;
    }
    setNext(h.next);
    api
      .takeHandoff(h.token)
      .then((s) => {
        if (session && session.user.id === s.user.id) return go(s, h.next);
        setPending(s);
      })
      .catch((e) => setError(toError(e)));
  }, []);
  if (pending && !error) {
    const current = session?.user.email;
    return (
      <AuthLayout title="Open NativeCloud?" eyebrow="NativeCloud">
        <p class="sec">
          This link opens NativeCloud as <strong>{pending.user.email}</strong>.
          {current ? (
            <>
              {" "}
              You're signed in here as <strong>{current}</strong>; continuing switches account.
            </>
          ) : null}{" "}
          Only continue if you just chose Manage on the web in one of your apps.
        </p>
        <div class="stack-2">
          <Button kind="primary" block busy={busy} onClick={() => go(pending, next)}>
            Continue as {pending.user.email}
          </Button>
          <a class="btn btn--ghost btn--block" href={current ? "/" : "/sign-in"}>
            Cancel
          </a>
        </div>
      </AuthLayout>
    );
  }
  if (!error) {
    return (
      <AuthLayout title="Signing you in" eyebrow="NativeCloud">
        <Skeleton rows={2} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="That link has expired" eyebrow="NativeCloud">
      <p class="sec">Links from the apps work once, for five minutes. Sign in here instead, or choose Manage on the web in the app again.</p>
      <a class="btn btn--primary btn--block" href={withNext("/sign-in", next)}>
        Sign in
      </a>
    </AuthLayout>
  );
}

const roleLine: Record<string, string> = { admin: "an admin", member: "a member", guest: "a guest" };

export function InviteLanding() {
  const { params } = useRoute();
  const id = params.id ?? "";
  const { session, me, ready, reload, signOut } = useSession();
  const { route, url } = useLocation();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session) return;
    api
      .inviteDetails(id)
      .then(setInvite)
      .catch((e) => setError(toError(e)));
  }, [session?.user.id, id]);
  if (!ready) {
    return (
      <AuthLayout title="Your invite" eyebrow="NativeCloud / Invite">
        <Skeleton rows={2} />
      </AuthLayout>
    );
  }
  if (!session || !me) {
    return (
      <AuthLayout title="You're invited" eyebrow="NativeCloud / Invite">
        <p class="sec">Sign in, or create an account, with the email address the invite was sent to. Then you can join.</p>
        <div class="stack-2">
          <a class="btn btn--primary btn--block" href={withNext("/sign-in", url)}>
            Sign in
          </a>
          <a class="btn btn--ghost btn--block" href={withNext("/sign-up", url)}>
            Create an account
          </a>
        </div>
      </AuthLayout>
    );
  }
  if (error) {
    return (
      <AuthLayout title="This invite isn't for you" eyebrow="NativeCloud / Invite">
        <p class="sec">
          You're signed in as {me.email}. The invite may be for another address, or it may have been taken back. Sign in with the address it was sent to.
        </p>
        <div class="stack-2">
          <Button
            kind="primary"
            block
            onClick={async () => {
              await signOut();
              route(withNext("/sign-in", url));
            }}
          >
            Use another account
          </Button>
          <a class="btn btn--ghost btn--block" href="/">
            Open NativeCloud
          </a>
        </div>
      </AuthLayout>
    );
  }
  if (!invite) {
    return (
      <AuthLayout title="Your invite" eyebrow="NativeCloud / Invite">
        <Skeleton rows={2} />
      </AuthLayout>
    );
  }
  if (invite.state !== "pending") {
    const what = { accepted: "You've already joined.", declined: "It was declined.", revoked: "It was taken back.", expired: "It has expired." }[invite.state];
    return (
      <AuthLayout title={`Invite to ${invite.org}`} eyebrow="NativeCloud / Invite">
        <p class="sec">{what} Ask an owner or admin of {invite.org} for a new one if you need it.</p>
        <a class="btn btn--primary btn--block" href={invite.state === "accepted" ? `/o/${invite.org_slug}` : "/"}>
          {invite.state === "accepted" ? `Open ${invite.org}` : "Open NativeCloud"}
        </a>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={`Join ${invite.org}`} eyebrow="NativeCloud / Invite">
      <p class="sec">
        {invite.invited_by || "Someone"} invited {invite.email} to {invite.org} as {roleLine[invite.role] ?? "a member"}.
      </p>
      <div class="stack-2">
        <Button
          kind="primary"
          block
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.acceptInvite(invite.id);
              await reload();
              toast(`You joined ${invite.org}.`);
              route(`/o/${invite.org_slug}`);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Join {invite.org}
        </Button>
        <Button
          kind="ghost"
          block
          onClick={async () => {
            try {
              await api.declineInvite(invite.id);
              toast("Invite declined.", "info");
              route("/");
            } catch (e) {
              fail(e);
            }
          }}
        >
          Decline
        </Button>
      </div>
    </AuthLayout>
  );
}
