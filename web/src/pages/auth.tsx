import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { AuthLayout, PRIVACY_URL, TERMS_URL } from "../ui/auth";
import { Button, Field, Rules } from "../ui/kit";
import { sb } from "../lib/supabase";
import { useSession } from "../lib/session";
import { query, safeNext, withNext } from "../lib/nav";
import { emailOk, passwordOk, passwordRules } from "../lib/format";
import { toError } from "../lib/errors";
import { toast } from "../ui/overlay";

function useNext(): string {
  return safeNext(query().get("next") ?? "/");
}

function useSignedInGoesOn(next: string) {
  const { session } = useSession();
  const { route } = useLocation();
  useEffect(() => {
    if (session) route(next, true);
  }, [session]);
}

function Err({ text }: { text: string | null }) {
  return text ? (
    <p class="error" role="alert">
      {text}
    </p>
  ) : null;
}

export function SignIn() {
  const next = useNext();
  const { route } = useLocation();
  useSignedInGoesOn(next);
  const [email, setEmail] = useState(query().get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toApp = next.startsWith("/login");
  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!emailOk(email) || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (!err) return;
    const ae = toError(err);
    if (ae.code === "email_not_confirmed") {
      await sb.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
      route(`/verify?email=${encodeURIComponent(email.trim().toLowerCase())}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
      return;
    }
    setError(ae.message);
  };
  return (
    <AuthLayout title="Sign in" eyebrow={toApp ? "NativeCloud / Sign in to an app" : "NativeCloud"}>
      <p class="sec">One account for every NativeCompute app.{toApp ? " After this, you go straight back to the app." : ""}</p>
      <form class="stack-6" onSubmit={submit} noValidate>
        <Field id="email" label="Email">
          <input class="input" id="email" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="password" label="Password" hint={<a class="link" href={withNext("/forgot", next)}>Forgot your password?</a>}>
          <input
            class="input"
            id="password"
            type="password"
            autocomplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Err text={error} />
        <Button kind="primary" type="submit" block busy={busy}>
          Sign in
        </Button>
      </form>
      <p class="or">New here</p>
      <a class="btn btn--ghost btn--block" href={withNext("/sign-up", next)}>
        Create an account
      </a>
    </AuthLayout>
  );
}

export function SignUp() {
  const next = useNext();
  const { route } = useLocation();
  useSignedInGoesOn(next);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    const address = email.trim().toLowerCase();
    if (!emailOk(address)) return setError("That doesn't look like an email address.");
    if (!passwordOk(password)) return setError("Use at least 10 characters, with upper and lower case letters and a digit.");
    setBusy(true);
    const { data, error: err } = await sb.auth.signUp({ email: address, password, options: { data: { display_name: name.trim() } } });
    setBusy(false);
    if (err) return setError(toError(err).message);
    if (!data.session) route(`/verify?email=${encodeURIComponent(address)}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  };
  return (
    <AuthLayout title="Create your account" eyebrow="NativeCloud">
      <p class="sec">Free for your own scripts. Nothing on your computer is uploaded until you choose it.</p>
      <form class="stack-6" onSubmit={submit} noValidate>
        <Field id="name" label="Your name" hint="How the people you write with see you." optional>
          <input class="input" id="name" autocomplete="name" maxLength={80} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="email" label="Email">
          <input class="input" id="email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="password" label="Password">
          <input
            class="input"
            id="password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Rules rules={passwordRules(password)} />
        <Err text={error} />
        <Button kind="primary" type="submit" block busy={busy}>
          Create account
        </Button>
        <p class="sec">
          By creating an account you agree to the{" "}
          <a class="link" href={TERMS_URL}>
            terms
          </a>{" "}
          and{" "}
          <a class="link" href={PRIVACY_URL}>
            privacy policy
          </a>
          .
        </p>
      </form>
      <a class="btn btn--quiet" href={withNext("/sign-in", next)}>
        I already have an account
      </a>
    </AuthLayout>
  );
}

function CodeInput({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  return (
    <input
      class="input otp"
      id="code"
      inputMode="numeric"
      autocomplete="one-time-code"
      maxLength={6}
      placeholder="000000"
      value={value}
      onInput={(e) => onInput((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 6))}
    />
  );
}

export function Verify() {
  const next = useNext();
  const email = (query().get("email") ?? "").toLowerCase();
  const { route } = useLocation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: Event) => {
    e?.preventDefault();
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    const { error: err } = await sb.auth.verifyOtp({ email, token: code, type: "signup" });
    setBusy(false);
    if (err) return setError(toError(err).message);
    toast("Welcome to NativeCloud. Your account is ready.");
    route(next, true);
  };
  useEffect(() => {
    if (code.length === 6) submit();
  }, [code]);
  return (
    <AuthLayout title="Check your email" eyebrow="NativeCloud">
      <p class="sec">We sent a 6-digit code to {email || "your email"}. It works for an hour.</p>
      <form class="stack-6" onSubmit={submit} noValidate>
        <Field id="code" label="Code">
          <CodeInput value={code} onInput={setCode} />
        </Field>
        <Err text={error} />
        <Button kind="primary" type="submit" block busy={busy}>
          Confirm
        </Button>
      </form>
      <div class="actions">
        <button
          class="btn btn--quiet btn--sm"
          type="button"
          onClick={async () => {
            const { error: err } = await sb.auth.resend({ type: "signup", email });
            if (err) setError(toError(err).message);
            else toast("A new code is on its way.");
          }}
        >
          Send a new code
        </button>
        <a class="btn btn--quiet btn--sm" href={withNext("/sign-up", next)}>
          Use a different email
        </a>
      </div>
    </AuthLayout>
  );
}

export function Forgot() {
  const next = useNext();
  const { route } = useLocation();
  const [email, setEmail] = useState(query().get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!emailOk(address)) return setError("That doesn't look like an email address.");
    setBusy(true);
    const { error: err } = await sb.auth.resetPasswordForEmail(address);
    setBusy(false);
    if (err) return setError(toError(err).message);
    route(`/reset?email=${encodeURIComponent(address)}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  };
  return (
    <AuthLayout title="Reset your password" eyebrow="NativeCloud">
      <p class="sec">We'll email you a code to set a new one.</p>
      <form class="stack-6" onSubmit={submit} noValidate>
        <Field id="email" label="Email">
          <input class="input" id="email" type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Err text={error} />
        <Button kind="primary" type="submit" block busy={busy}>
          Send code
        </Button>
      </form>
      <a class="btn btn--quiet" href={withNext("/sign-in", next)}>
        Back to sign in
      </a>
    </AuthLayout>
  );
}

export function Reset() {
  const next = useNext();
  const email = (query().get("email") ?? "").toLowerCase();
  const { route } = useLocation();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code from the email.");
    if (!passwordOk(password)) return setError("Use at least 10 characters, with upper and lower case letters and a digit.");
    setBusy(true);
    const verified = await sb.auth.verifyOtp({ email, token: code, type: "recovery" });
    if (verified.error) {
      setBusy(false);
      return setError(toError(verified.error).message);
    }
    const { error: err } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(toError(err).message);
    toast("Password changed. You're signed in.");
    route(next, true);
  };
  return (
    <AuthLayout title="Choose a new password" eyebrow="NativeCloud">
      <p class="sec">Enter the code we sent to {email || "your email"} and your new password.</p>
      <form class="stack-6" onSubmit={submit} noValidate>
        <Field id="code" label="Code">
          <CodeInput value={code} onInput={setCode} />
        </Field>
        <Field id="password" label="New password">
          <input
            class="input"
            id="password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Rules rules={passwordRules(password)} />
        <Err text={error} />
        <Button kind="primary" type="submit" block busy={busy}>
          Set password
        </Button>
      </form>
      <a class="btn btn--quiet" href={withNext("/forgot", next)}>
        Send a new code
      </a>
    </AuthLayout>
  );
}
