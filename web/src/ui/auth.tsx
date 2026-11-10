import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icons";
import { applyTheme, savedTheme } from "../lib/theme";
import logoDark from "../ncf/brand/logo-dark.svg";
import logoLight from "../ncf/brand/logo.svg";

export const TERMS_URL = "https://nativecompute.net/cloud/terms";
export const PRIVACY_URL = "https://nativecompute.net/cloud/privacy";

export function AuthLayout({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ComponentChildren }) {
  const [theme, setTheme] = useState(savedTheme());
  useEffect(() => {
    document.title = `${title} · NativeCloud`;
  }, [title]);
  return (
    <div class="auth">
      <header class="auth-top">
        <a class="brand" href="/" aria-label="NativeCloud">
          <img class="on-dark" src={logoDark} alt="NativeCompute" width="153" height="20" />
          <img class="on-light" src={logoLight} alt="NativeCompute" width="153" height="20" />
          <span class="hud">Cloud</span>
        </a>
        <button
          class="icon-btn"
          type="button"
          aria-label={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
          onClick={() => {
            const t = theme === "dark" ? "light" : "dark";
            applyTheme(t);
            setTheme(t);
          }}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </header>
      <main class="auth-main" id="main">
        <div class="auth-card">
          <div class="stack-2">
            {eyebrow ? <p class="hud">{eyebrow}</p> : null}
            <h1 class="page-title">{title}</h1>
          </div>
          {children}
        </div>
      </main>
      <footer class="auth-foot">
        <span class="hud">NativeCloud by NativeCompute</span>
        <span class="actions">
          <a class="maker" href={TERMS_URL}>
            Terms
          </a>
          <a class="maker" href={PRIVACY_URL}>
            Privacy
          </a>
        </span>
      </footer>
    </div>
  );
}
