import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";
import { sb } from "../lib/supabase";
import { ApiError, toError } from "../lib/errors";

type Toast = { id: number; text: string; tone: "ok" | "info" | "danger"; shown: boolean };
type Ask = {
  title: string;
  body: ComponentChildren;
  yes: string;
  danger?: boolean;
  typed?: string;
  password?: boolean;
  resolve: (v: string | null) => void;
};

let toasts: Toast[] = [];
let ask: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let next = 1;

export function toast(text: string, tone: Toast["tone"] = "ok"): void {
  const t: Toast = { id: next++, text, tone, shown: false };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => {
    toasts = toasts.map((x) => (x.id === t.id ? { ...x, shown: true } : x));
    emit();
  }, 16);
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, tone === "danger" ? 7000 : 4200);
}

export function fail(e: unknown): void {
  toast(toError(e).message, "danger");
}

export function confirm(o: { title: string; body: ComponentChildren; yes: string; danger?: boolean; typed?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    ask = { ...o, resolve: (v) => resolve(v !== null) };
    emit();
  });
}

export function askPassword(title = "Enter your password"): Promise<string | null> {
  return new Promise((resolve) => {
    ask = { title, body: "For your safety, confirm it's you before this change.", yes: "Confirm", password: true, resolve };
    emit();
  });
}

export async function fresh<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    const err = toError(e);
    if (err.head !== "reauth") throw err;
    const pw = await askPassword();
    if (pw === null) return undefined;
    const email = (await sb.auth.getUser()).data.user?.email ?? "";
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) throw new ApiError("invalid_credentials");
    return await run();
  }
}

function useOverlay() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function Overlays() {
  useOverlay();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) {
      setTyped("");
      d.showModal();
    }
    if (!ask && d.open) d.close();
  });
  const done = (v: string | null) => {
    const a = ask;
    ask = null;
    emit();
    a?.resolve(v);
  };
  const ok = !ask?.typed || typed.trim() === ask.typed;
  return (
    <>
      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast${t.shown ? " is-in" : ""}`} role={t.tone === "danger" ? "alert" : "status"}>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <dialog
        class="confirm"
        ref={ref}
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          done(null);
        }}
      >
        {ask ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (ok) done(ask?.password || ask?.typed ? typed : "yes");
            }}
          >
            <div class="confirm-body">
              <h2 class="h3" id="confirm-title">
                {ask.title}
              </h2>
              <div class="sec">{ask.body}</div>
              {ask.typed ? (
                <div class="field">
                  <label for="confirm-typed">Type {ask.typed} to confirm</label>
                  <input class="input" id="confirm-typed" autocomplete="off" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
                </div>
              ) : null}
              {ask.password ? (
                <div class="field">
                  <label for="confirm-password">Password</label>
                  <input
                    class="input"
                    id="confirm-password"
                    type="password"
                    autocomplete="current-password"
                    value={typed}
                    onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
                  />
                </div>
              ) : null}
            </div>
            <div class="confirm-foot">
              <button class="btn btn--quiet btn--sm" type="button" onClick={() => done(null)}>
                Cancel
              </button>
              <button class={`btn btn--sm ${ask.danger ? "btn--danger" : "btn--primary"}`} type="submit" disabled={!ok}>
                {ask.yes}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}

export function Tray({ open, title, onClose, children, foot }: { open: boolean; title: string; onClose: () => void; children: ComponentChildren; foot?: ComponentChildren }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, [open]);
  return (
    <div class={`tray-root${open ? " is-open" : ""}`} aria-hidden={open ? undefined : "true"}>
      <div class="tray-scrim" onClick={onClose} />
      <aside class="tray" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div class="tray-head">
          <h2>{title}</h2>
          <button class="icon-btn" type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="tray-body">{open ? children : null}</div>
        {foot ? <div class="tray-foot">{foot}</div> : null}
      </aside>
    </div>
  );
}
