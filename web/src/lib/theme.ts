export type Theme = "dark" | "light";
const KEY = "nativecloud-theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "dark" || t === "light") return t;
  } catch {
    return "dark";
  }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    return;
  }
}
