import type { ComponentChildren, JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Link } from "./link";
import { initials, level, share } from "../lib/format";
import type { ApiError } from "../lib/errors";

export function Avatar({ name, hue, size }: { name: string; hue: number; size?: "sm" | "lg" }) {
  return (
    <span class={`avatar${size ? ` avatar--${size}` : ""}`} style={{ "--hue": String(((hue % 360) + 360) % 360) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function PersonLine({ name, hue, line }: { name: string; hue: number; line?: string | null }) {
  return (
    <div class="person">
      <Avatar name={name} hue={hue} />
      <span class="who">
        <strong>{name}</strong>
        {line ? <span>{line}</span> : null}
      </span>
    </div>
  );
}

export function Meter({ label, used, max, shown }: { label?: string; used: number; max: number; shown?: string }) {
  return (
    <div class="meter" data-level={level(used, max)} style={{ "--k": String(share(used, max)) }}>
      {label ? (
        <div class="meter-top">
          <span>{label}</span>
          <span class="hud">{shown}</span>
        </div>
      ) : null}
      <div
        class="meter-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(used, max)}
        aria-valuetext={shown}
      />
    </div>
  );
}

export function State({ tone, children }: { tone?: "ok" | "signal" | "warn" | "danger"; children: ComponentChildren }) {
  return <span class={`state${tone ? ` state--${tone}` : ""}`}>{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} class="skeleton skeleton--row" />
      ))}
    </div>
  );
}

export function Problem({ error, retry }: { error: ApiError; retry?: () => void }) {
  return (
    <div class="banner" role="alert">
      <span>{error.message}</span>
      {retry ? (
        <button class="btn btn--quiet btn--sm" type="button" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Page({
  eyebrow,
  title,
  sub,
  action,
  children,
}: {
  eyebrow?: ComponentChildren;
  title: string;
  sub?: ComponentChildren;
  action?: ComponentChildren;
  children?: ComponentChildren;
}) {
  useEffect(() => {
    document.title = `${title} · NativeCloud`;
  }, [title]);
  return (
    <div class="page">
      <div class="page-head">
        <div>
          {eyebrow ? <p class="hud">{eyebrow}</p> : null}
          <h1 class="page-title">{title}</h1>
          {sub ? <p class="page-sub">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Block({ title, aside, children, class: cls }: { title: string; aside?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`block${cls ? ` ${cls}` : ""}`} aria-label={title}>
      <div class="block-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: ComponentChildren;
  error?: string | null;
  optional?: boolean;
  children: ComponentChildren;
}) {
  return (
    <div class="field" data-invalid={error ? "true" : undefined}>
      <label for={id}>
        {label}
        {optional ? <span class="opt">Optional</span> : null}
      </label>
      {children}
      {hint ? <p class="hint">{hint}</p> : null}
      {error ? (
        <p class="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "ghost" | "quiet" | "danger";
  small?: boolean;
  block?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
};

export function Button({ kind = "ghost", small, block, busy, type = "button", children, disabled, ...rest }: ButtonProps) {
  const cls = `btn btn--${kind}${small ? " btn--sm" : ""}${block ? " btn--block" : ""}`;
  return (
    <button class={cls} type={type} aria-busy={busy ? "true" : undefined} disabled={disabled || busy} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ href, kind = "ghost", small, children }: { href: string; kind?: "primary" | "ghost" | "quiet"; small?: boolean; children: ComponentChildren }) {
  return (
    <Link class={`btn btn--${kind}${small ? " btn--sm" : ""}`} href={href}>
      {children}
    </Link>
  );
}

export function Rules({ rules }: { rules: [string, boolean][] }) {
  return (
    <ul class="actions" aria-label="Password rules">
      {rules.map(([label, ok]) => (
        <li key={label}>
          <State tone={ok ? "ok" : undefined}>{label}</State>
        </li>
      ))}
    </ul>
  );
}

export function Switch({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="check" for={id}>
      <span class="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        <span />
      </span>
      <span class="t">
        <span>{label}</span>
        {hint ? <span>{hint}</span> : null}
      </span>
    </label>
  );
}
