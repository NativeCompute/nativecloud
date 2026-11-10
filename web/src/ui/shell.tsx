import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { Icon, type IconName } from "./icons";
import { Avatar } from "./kit";
import { useSession } from "../lib/session";
import { api, type Me, type OrgRef } from "../lib/api";
import { applyTheme, savedTheme } from "../lib/theme";
import { planName } from "../lib/format";
import logoDark from "../ncf/brand/logo-dark.svg";
import logoLight from "../ncf/brand/logo.svg";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export function orgOf(path: string, me: Me | null): OrgRef | null {
  const m = path.match(/^\/o\/([^/]+)/);
  if (!m || !me) return null;
  return me.orgs.find((o) => o.slug === m[1]) ?? null;
}

function orgNav(o: OrgRef): NavItem[] {
  const base = `/o/${o.slug}`;
  const items: NavItem[] = [
    { href: base, label: "Overview", icon: "home" },
    { href: `${base}/projects`, label: "Projects", icon: "file" },
    { href: `${base}/spaces`, label: "Spaces", icon: "grid" },
    { href: `${base}/members`, label: "Members", icon: "users" },
    { href: `${base}/plan`, label: "Plan and usage", icon: "chart" },
  ];
  items.push({ href: `${base}/settings`, label: "Settings", icon: "settings" });
  return items;
}

const accountNav: NavItem[] = [
  { href: "/me", label: "My cloud", icon: "cloud" },
  { href: "/account", label: "Account", icon: "user" },
  { href: "/account/computers", label: "Computers", icon: "laptop" },
  { href: "/account/data", label: "Your data", icon: "download" },
];

const titles: Record<string, string> = {
  "": "Overview",
  projects: "Projects",
  spaces: "Spaces",
  members: "Members",
  plan: "Plan and usage",
  settings: "Settings",
};

function crumbs(path: string, me: Me | null): { label: string; href?: string }[] {
  const o = orgOf(path, me);
  if (o) {
    const section = path.split("/")[3] ?? "";
    return [{ label: o.name, href: `/o/${o.slug}` }, { label: titles[section] ?? "Overview" }];
  }
  if (path.startsWith("/staff")) return [{ label: "Staff", href: "/staff" }, ...(path === "/staff" ? [] : [{ label: path.includes("/orgs/") ? "Organization" : "Person" }])];
  if (path === "/new") return [{ label: "Organizations" }, { label: "New" }];
  const label = accountNav.find((n) => n.href === path)?.label ?? "My cloud";
  return [{ label: "My cloud", href: "/me" }, ...(path === "/me" ? [] : [{ label }])];
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return ref;
}

function Switcher({ me, current }: { me: Me; current: OrgRef | null }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const { route } = useLocation();
  const go = (href: string) => {
    setOpen(false);
    route(href);
  };
  const name = current?.name ?? "My cloud";
  const line = current ? `${planName(current.plan)} · ${current.role}` : `${planName(me.plan.id)} · personal`;
  return (
    <div class="side-head menu-wrap" ref={ref}>
      <button class="switcher" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar name={name} hue={current ? hash(current.id) : me.avatar_hue} />
        <span class="who">
          <strong>{name}</strong>
          <span class="hud">{line}</span>
        </span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <div class="menu" role="menu">
          <button class="menu-item" role="menuitemradio" aria-checked={!current} type="button" onClick={() => go("/me")}>
            My cloud
          </button>
          {me.orgs.map((o) => (
            <button key={o.id} class="menu-item" role="menuitemradio" aria-checked={current?.id === o.id} type="button" onClick={() => go(`/o/${o.slug}`)}>
              {o.name}
            </button>
          ))}
          <div class="menu-sep" />
          <button class="menu-item" role="menuitem" type="button" onClick={() => go("/new")}>
            <Icon name="plus" /> Create organization
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const { route } = useLocation();
  const { signOut } = useSession();
  const [theme, setTheme] = useState(savedTheme());
  const go = (href: string) => {
    setOpen(false);
    route(href);
  };
  return (
    <div class="side-foot menu-wrap" ref={ref}>
      <button class="switcher" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar name={me.display_name || me.email} hue={me.avatar_hue} />
        <span class="who">
          <strong>{me.display_name || me.email.split("@")[0]}</strong>
          <span class="hud">{me.email}</span>
        </span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <div class="menu menu--up" role="menu">
          <button class="menu-item" role="menuitem" type="button" onClick={() => go("/account")}>
            <Icon name="user" /> Account
          </button>
          <button class="menu-item" role="menuitem" type="button" onClick={() => go("/account/computers")}>
            <Icon name="laptop" /> Computers
          </button>
          <button class="menu-item" role="menuitem" type="button" onClick={() => go("/account/data")}>
            <Icon name="download" /> Your data
          </button>
          <button
            class="menu-item"
            role="menuitem"
            type="button"
            onClick={() => {
              const t = theme === "dark" ? "light" : "dark";
              applyTheme(t);
              setTheme(t);
            }}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} /> {theme === "dark" ? "Light" : "Dark"} theme
          </button>
          <div class="menu-sep" />
          <button
            class="menu-item"
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await signOut();
              route("/sign-in");
            }}
          >
            <Icon name="out" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface Hit {
  group: string;
  label: string;
  hint?: string;
  href: string;
}

function Palette({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [found, setFound] = useState<Hit[]>([]);
  const { route } = useLocation();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setAt(0);
      setFound([]);
      d.showModal();
      setTimeout(() => input.current?.focus(), 0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const fixed = useMemo<Hit[]>(() => {
    const out: Hit[] = [{ group: "Go to", label: "My cloud", href: "/me" }];
    for (const o of me.orgs) {
      out.push({ group: "Organizations", label: o.name, hint: planName(o.plan), href: `/o/${o.slug}` });
      for (const n of orgNav(o).slice(1)) out.push({ group: "Organizations", label: `${o.name}: ${n.label}`, href: n.href });
    }
    for (const n of accountNav.slice(1)) out.push({ group: "Account", label: n.label, href: n.href });
    out.push({ group: "Account", label: "Create organization", href: "/new" });
    if (me.staff) out.push({ group: "Staff", label: "Staff console", hint: me.staff, href: "/staff" });
    return out;
  }, [me]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .findProjects(text)
        .then((list) => setFound(list.map((p) => ({ group: "Projects", label: p.title || "Untitled", hint: p.app_id, href: `/p/${p.id}` }))))
        .catch(() => setFound([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [...fixed.filter((h) => words.every((w) => h.label.toLowerCase().includes(w))), ...found].slice(0, 40);
  const pick = (h: Hit | undefined) => {
    if (!h) return;
    onClose();
    route(h.href);
  };
  let group = "";
  return (
    <dialog
      class="palette"
      ref={ref}
      aria-label="Find anything"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <input
        ref={input}
        class="palette-input"
        placeholder="Jump to an organization, project or setting"
        aria-label="Search"
        aria-controls="palette-list"
        aria-activedescendant={hits[at] ? `palette-${at}` : undefined}
        value={q}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt(Math.min(hits.length - 1, at + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt(Math.max(0, at - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[at]);
          }
        }}
      />
      <div class="palette-list" role="listbox" id="palette-list">
        {hits.length === 0 ? <p class="palette-group">Nothing matches</p> : null}
        {hits.map((h, i) => {
          const head = h.group !== group ? <p class="palette-group">{h.group}</p> : null;
          group = h.group;
          return (
            <>
              {head}
              <button
                id={`palette-${i}`}
                class="palette-item"
                role="option"
                type="button"
                aria-selected={i === at}
                onMouseMove={() => setAt(i)}
                onClick={() => pick(h)}
              >
                {h.label}
                {h.hint ? <span class="hud">{h.hint}</span> : null}
              </button>
            </>
          );
        })}
      </div>
      <div class="palette-foot">
        <span class="hud">
          <kbd>↑</kbd> <kbd>↓</kbd> Move
        </span>
        <span class="hud">
          <kbd>Enter</kbd> Open
        </span>
        <span class="hud">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </dialog>
  );
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function Shell({ children }: { children: ComponentChildren }) {
  const { me } = useSession();
  const { path } = useLocation();
  const [nav, setNav] = useState(false);
  const [find, setFind] = useState(false);
  useEffect(() => setNav(false), [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFind(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  if (!me) return null;
  const current = orgOf(path, me);
  const items = current ? orgNav(current) : accountNav;
  const trail = crumbs(path, me);
  const active = (href: string) => (href === path || (href !== `/o/${current?.slug}` && href !== "/me" && path.startsWith(`${href}/`)) ? "page" : undefined);
  return (
    <div class="app" data-nav={nav ? "open" : undefined}>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <button class="side-scrim" type="button" aria-label="Close menu" tabIndex={nav ? 0 : -1} onClick={() => setNav(false)} />
      <aside class="side" aria-label="Sections">
        <Switcher me={me} current={current} />
        <nav class="side-nav" aria-label={current ? current.name : "My cloud"}>
          {items.map((n) => (
            <a key={n.href} class="side-link" href={n.href} aria-current={active(n.href)}>
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
          {current ? (
            <>
              <div class="side-sep" />
              <a class="side-link" href="/me">
                <Icon name="cloud" />
                My cloud
              </a>
            </>
          ) : null}
          {me.staff ? (
            <>
              <div class="side-sep" />
              <p class="side-label">Staff</p>
              <a class="side-link" href="/staff" aria-current={path.startsWith("/staff") ? "page" : undefined}>
                <Icon name="shield" />
                Staff console
              </a>
            </>
          ) : null}
        </nav>
        <UserMenu me={me} />
      </aside>
      <div>
        <header class="topbar">
          <button class="icon-btn nav-btn" type="button" aria-label="Open menu" aria-expanded={nav} onClick={() => setNav(true)}>
            <Icon name="menu" />
          </button>
          <a class="brand topbar-brand" href="/" aria-label="NativeCloud home">
            <img class="on-dark" src={logoDark} alt="NativeCompute" width="122" height="16" />
            <img class="on-light" src={logoLight} alt="NativeCompute" width="122" height="16" />
          </a>
          <nav class="crumbs" aria-label="Breadcrumb">
            {trail.map((c, i) => (
              <>
                {i ? <span class="slash">/</span> : null}
                {c.href && i < trail.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
              </>
            ))}
          </nav>
          <div class="topbar-actions">
            <button class="find-btn" type="button" onClick={() => setFind(true)}>
              <Icon name="search" width="16" height="16" />
              Find anything <kbd>{isMac() ? "⌘" : "Ctrl"}</kbd>
              <kbd>K</kbd>
            </button>
            <button class="icon-btn find-icon" type="button" aria-label="Find anything" onClick={() => setFind(true)}>
              <Icon name="search" />
            </button>
          </div>
        </header>
        <main id="main">{children}</main>
      </div>
      <Palette me={me} open={find} onClose={() => setFind(false)} />
    </div>
  );
}
