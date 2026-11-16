export type ThemeId = "rosa" | "roxo" | "amarelo";

/** Ordem do seletor de tema: rosa, roxo, amarelo. */
export const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: "rosa", label: "Rosa", color: "#FF48A8" },
  { id: "roxo", label: "Violeta", color: "#AD78FF" },
  { id: "amarelo", label: "Amarelo", color: "#FFD629" },
];

export interface Profile {
  id: string;
  name: string;
  /** Caminho completo do executável que dispara o perfil. */
  executable: string;
  /** 0–200. 50 = cores normais, 100 = limite do driver, >100 = Super Vibrance. */
  vibrance: number;
  applyOnOpen: boolean;
  restoreOnClose: boolean;
}

export interface Settings {
  theme: ThemeId;
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
}

export type SuperMethod = "magnifier" | "none";

export interface Capabilities {
  /** true quando rodando no navegador (sem integração com Windows). */
  demo: boolean;
  superMethod: SuperMethod;
  /** Motivo quando Super Vibrance não está disponível. */
  superReason: string | null;
}

export type GameState = "idle" | "active" | "unavailable";

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
    },
  ],
};

export const NEUTRAL = 50;
export const DRIVER_MAX = 100;
export const SUPER_MAX = 200;
