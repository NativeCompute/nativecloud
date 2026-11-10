import type { JSX } from "preact";

export function Link(props: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
