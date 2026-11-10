import type { JSX } from "preact";

const paths: Record<string, string> = {
  menu: "M3 6h14M3 10h14M3 14h14",
  close: "m5 5 10 10M15 5 5 15",
  chevron: "m5 8 5 5 5-5",
  right: "m8 5 5 5-5 5",
  plus: "M10 4v12M4 10h12",
  search: "m13.5 13.5 3 3M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Z",
  home: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1Z",
  file: "M5 2.5h6l4 4V17a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 17ZM11 2.5V7h4",
  grid: "M3.5 3.5h5v5h-5ZM11.5 3.5h5v5h-5ZM3.5 11.5h5v5h-5ZM11.5 11.5h5v5h-5Z",
  users: "M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17c0-3 2.2-5 5-5s5 2 5 5M13 3.3a3 3 0 0 1 0 5.4M14.5 12.4c1.8.6 3 2.3 3 4.6",
  chart: "M3 17h14M5 14V9M9 14V5M13 14v-7M17 14v-3",
  settings: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6",
  cloud: "M6 15.5h8.5a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 5.3 9.6 3 3 0 0 0 6 15.5Z",
  shield: "M10 2.5 16 5v5c0 3.6-2.5 6.4-6 7.5-3.5-1.1-6-3.9-6-7.5V5Z",
  laptop: "M4 5h12v8H4ZM2 15.5h16",
  download: "M10 3v10M5.5 8.5 10 13l4.5-4.5M4 17h12",
  trash: "M4 6h12M8 6V4h4v2M5.5 6l.8 11h7.4l.8-11",
  restore: "M4 10a6 6 0 1 0 1.8-4.3M4 3v4h4",
  out: "M8 4H4.5v12H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5",
  sun: "M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4",
  moon: "M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z",
  key: "M7 12.5a3.5 3.5 0 1 1 2.6-5.8L17 6.7V10h-2v2h-2.5M6 9.5h.01",
  user: "M10 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 17.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6",
  external: "M11 3.5h5.5V9M16.5 3.5 9 11M14 12.5V16.5H3.5V6H7.5",
  check: "m4 10.5 4 4 8-9",
  eye: "M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10ZM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...rest }: { name: IconName } & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
