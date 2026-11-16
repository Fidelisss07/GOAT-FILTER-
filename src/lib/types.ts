export type ThemeId = "rosa" | "roxo" | "amarelo";

/** Ordem do seletor de tema: rosa, roxo, amarelo. */
export const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: "rosa", label: "Rosa", color: "#FF48A8" },
  { id: "roxo", label: "Violeta", color: "#AD78FF" },
  { id: "amarelo", label: "Amarelo", color: "#FFD629" },
];

export type EmphasisColor = "none" | "red" | "yellow" | "purple";

export const EMPHASIS: { id: EmphasisColor; label: string; color: string | null }[] = [
  { id: "none", label: "Nenhum", color: null },
  { id: "red", label: "Vermelho", color: "#EB3B3B" },
  { id: "yellow", label: "Amarelo", color: "#EDED0D" },
  { id: "purple", label: "Roxo", color: "#B838E6" },
];

/** Ajustes finos além do vibrance. */
export interface Tuning {
  emphasis: EmphasisColor;
  /** 0–100: quanto a mais a cor escolhida ganha (100 = 2×). */
  emphasisStrength: number;
  /** −50..50 */
  brightness: number;
  /** 50..150 (%) */
  contrast: number;
  /** 50..200 (= 0,5..2,0). Acima de 100 clareia as sombras. */
  gamma: number;
}

export const DEFAULT_TUNING: Tuning = { emphasis: "none", emphasisStrength: 50, brightness: 0, contrast: 100, gamma: 100 };

export const hasCurve = (t: Tuning) => t.brightness !== 0 || t.contrast !== 100 || t.gamma !== 100;
export const isNeutral = (t: Tuning) => t.emphasis === "none" && !hasCurve(t);

export interface Profile {
  id: string;
  name: string;
  /** Caminho completo do executável que dispara o perfil. */
  executable: string;
  /** 0–200. 50 = cores normais, 100 = limite do driver, >100 = Super Vibrance. */
  vibrance: number;
  applyOnOpen: boolean;
  restoreOnClose: boolean;
  tuning: Tuning;
  /** Só aplica com o jogo em primeiro plano (alt-tab volta ao normal). */
  focusOnly: boolean;
}

export interface Settings {
  theme: ThemeId;
  /** Método preferido para a faixa acima de 100%. */
  superMethod: SuperMethod;
  /** Atalhos globais Ctrl+Alt+G e Ctrl+Alt+↑/↓. */
  hotkeys: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  /** Id do monitor usado pelos perfis; null = monitor principal. */
  defaultMonitor: string | null;
  restoreOnExit: boolean;
  profiles: Profile[];
}

export type DriverKind = "nvidia" | "amd" | "none";

export interface MonitorInfo {
  id: string;
  name: string;
  primary: boolean;
  /** Mecanismo de vibrance do driver disponível neste monitor. */
  driver: DriverKind;
  /** Valor atual efetivo (0–200), se puder ser lido. */
  current: number | null;
  /** Padrão do driver (0–100), se o driver expuser. */
  driverDefault: number | null;
  /** Valor que estava antes de o Goat Filter mexer (0–200). */
  original: number | null;
  tuning: Tuning;
}

export type SuperMethod = "magnifier" | "mhc2" | "none";

export interface MethodInfo {
  method: Exclude<SuperMethod, "none">;
  available: boolean;
  reason: string | null;
}

export interface Capabilities {
  /** true quando rodando no navegador (sem integração com Windows). */
  demo: boolean;
  /** Método em uso agora. */
  superMethod: SuperMethod;
  /** Motivo quando Super Vibrance não está disponível. */
  superReason: string | null;
  methods: MethodInfo[];
  /** Brilho/contraste/gama disponíveis. */
  curves: boolean;
}

export const METHOD_LABEL: Record<Exclude<SuperMethod, "none">, { title: string; detail: string }> = {
  magnifier: {
    title: "Matriz do Windows",
    detail: "Qualquer placa, Windows 10 e 11. Use o jogo em “Janela em tela cheia”.",
  },
  mhc2: {
    title: "Perfil de cor MHC2 (experimental)",
    detail: "Windows 11. Aplicado pela GPU: sem input lag e também em tela cheia.",
  },
};

export interface Notice {
  kind: "ok" | "error" | "info";
  text: string;
}

export type GameState = "idle" | "active" | "paused" | "unavailable";

export interface GameStatus {
  state: GameState;
  profileId: string | null;
  message: string | null;
}

export interface Snapshot {
  capabilities: Capabilities;
  monitors: MonitorInfo[];
  settings: Settings;
  game: GameStatus;
}

export const VALORANT_ID = "valorant";

export const DEFAULT_SETTINGS: Settings = {
  theme: "roxo",
  superMethod: "magnifier",
  hotkeys: true,
  startWithWindows: false,
  minimizeToTray: true,
  defaultMonitor: null,
  restoreOnExit: true,
  profiles: [
    {
      id: VALORANT_ID,
      name: "Valorant",
      executable: "C:\\Riot Games\\VALORANT\\live\\VALORANT.exe",
      vibrance: 75,
      applyOnOpen: true,
      restoreOnClose: true,
      tuning: DEFAULT_TUNING,
      focusOnly: false,
    },
  ],
};

export const NEUTRAL = 50;
export const DRIVER_MAX = 100;
export const SUPER_MAX = 200;
