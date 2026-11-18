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
  <svg {...base} strokeWidth={1.65} {...p}><path d="M3 10.5 12 3l9 7.5M5.5 9v11h5v-6h3v6h5V9" /></svg>
);
export const LayersIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></svg>
);
export const GearIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" /></svg>
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
  <svg {...base} strokeWidth={1.65} {...p}><path d="M3 4h18v13H3zM12 17v4m-5 0h10" /></svg>
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
export const BoltIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" /></svg>
);
export const KeyboardIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15.5h8" />
  </svg>
);
export const ListIcon = (p: P) => (
  <svg {...base} {...p}><path d="m4 6.5 1.5 1.5L8 5.5M4 12.5 5.5 14 8 11.5M4 18.5 5.5 20 8 17.5M11 7h9M11 13h9M11 19h9" /></svg>
);
export const TargetIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}>
    <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
  </svg>
);
export const RecordIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}>
    <rect x="2.5" y="6" width="14" height="12" rx="2.5" /><path d="m16.5 10.5 5-3v9l-5-3" /><circle cx="9.5" cy="12" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);
export const SparkIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5-6.5-2L10 9z" /><path d="M19 3v3M17.5 4.5h3" /></svg>
);
export const SlidersIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}>
    <path d="M3 5h5m4 0h9M3 12h10m4 0h4M3 19h2m4 0h12M10 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-8 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  </svg>
);
export const GamepadIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}>
    <path d="M7.5 7h9a5 5 0 0 1 4.9 6l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.5 16h-5l-1.8 2.2a2.5 2.5 0 0 1-4.3-1.2l-.8-4A5 5 0 0 1 7.5 7Z" />
    <path d="M8 10v3M6.5 11.5h3M15.5 11h.01M17.5 12.5h.01" />
  </svg>
);
export const CheckSquareIcon = (p: P) => (
  <svg {...base} strokeWidth={1.65} {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m8 12.5 3 3 5.5-6" /></svg>
);
export const DotsIcon = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
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
