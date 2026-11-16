import { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const HomeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v12h5v-6h4v6h5V9" /></svg>
);
export const LayersIcon = (p: P) => (
  <svg {...base} {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12.5 9 5 9-5" /><path d="m3 16.5 9 5 9-5" /></svg>
);
export const GearIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1Z" />
  </svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base} strokeWidth={2.2} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} strokeWidth={3} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base} strokeWidth={2.4} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const FolderIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z" /></svg>
);
export const MonitorIcon = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="3.5" width="19" height="13" rx="1.5" /><path d="M12 16.5V20M8 20.5h8" /></svg>
);
export const PowerIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 3v8" /><path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
);
export const MonitorGearIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3.5" width="19" height="13" rx="1.5" /><path d="M12 16.5V20M8 20.5h8" />
    <circle cx="12" cy="10" r="2" />
    <path d="M12 6.5v1M12 12.5v1M8.5 10h1M14.5 10h1M9.6 7.6l.7.7M13.7 11.7l.7.7M9.6 12.4l.7-.7M13.7 8.3l.7-.7" />
  </svg>
);
export const SparkIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5-6.5-2L10 9z" /><path d="M19 3v3M17.5 4.5h3" /></svg>
);
export const ArrowsLR = (p: P) => (
  <svg {...base} strokeWidth={2.4} {...p}><path d="m9 7-5 5 5 5M15 7l5 5-5 5" /></svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const WinMin = (p: P) => (<svg {...base} strokeWidth={1.4} {...p}><path d="M5 12h14" /></svg>);
export const WinMax = (p: P) => (<svg {...base} strokeWidth={1.4} {...p}><rect x="5" y="5" width="14" height="14" /></svg>);
export const WinClose = (p: P) => (<svg {...base} strokeWidth={1.4} {...p}><path d="m5 5 14 14M19 5 5 19" /></svg>);

/** Ícone genérico para perfis que não são o Valorant. */
export const GameIcon = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="7" width="19" height="10" rx="5" /><path d="M7 10.5v3M5.5 12h3" /><circle cx="15.5" cy="11" r="1" fill="currentColor" /><circle cx="17.5" cy="13" r="1" fill="currentColor" /></svg>
);

/** "V" estilizado (não é a marca oficial do jogo). */
export const ValorantMark = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden {...p}>
    <path fill="#ff4655" d="M2 5l11 13.5H8.2L2 11z" />
    <path fill="#ff4655" d="M22 5v6.5l-3.6 4.4h-4.6z" />
  </svg>
);
