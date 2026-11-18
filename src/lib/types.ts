export type ThemeId = "rosa" | "roxo" | "amarelo";

/** Ordem do seletor de tema: rosa, roxo, amarelo. */
export const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: "rosa", label: "Rosa", color: "#FF48A8" },
  { id: "roxo", label: "Roxo", color: "#AD78FF" },
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
  /** Brilho do próprio monitor via DDC/CI (0–100). null = não mexe. */
  monitorBrightness: number | null;
  monitorContrast: number | null;
  monitorSaturation: number | null;
}

/** Valores atuais do próprio monitor (0–100). null = o monitor não aceita. */
export interface MonitorHwState {
  brightness: number | null;
  contrast: number | null;
  saturation: number | null;
}

export const DEFAULT_TUNING: Tuning = {
  emphasis: "none",
  emphasisStrength: 50,
  brightness: 0,
  contrast: 100,
  gamma: 100,
  monitorBrightness: null,
  monitorContrast: null,
  monitorSaturation: null,
};

export const hasCurve = (t: Tuning) => t.brightness !== 0 || t.contrast !== 100 || t.gamma !== 100;
export const hasMonitorHw = (t: Tuning) =>
  t.monitorBrightness != null || t.monitorContrast != null || t.monitorSaturation != null;
export const isNeutral = (t: Tuning) => t.emphasis === "none" && !hasCurve(t) && !hasMonitorHw(t);

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

/** Ajustes do Windows aplicados enquanto o jogo está aberto. */
export interface PerfTweaks {
  mouseAccelOff: boolean;
  keyboardFast: boolean;
  highPerformancePower: boolean;
}

/** Teclas dos atalhos do Goat Filter, no formato "Ctrl+Alt+KeyG". */
export interface Bindings {
  toggle: string;
  vibranceUp: string;
  vibranceDown: string;
  nextProfile: string;
  /** Salva os últimos segundos (replay instantâneo). */
  saveClip: string;
  /** Começa/para a gravação de gameplay. */
  toggleRecord: string;
}

export const DEFAULT_BINDINGS: Bindings = {
  toggle: "Ctrl+Alt+KeyG",
  vibranceUp: "Ctrl+Alt+ArrowUp",
  vibranceDown: "Ctrl+Alt+ArrowDown",
  nextProfile: "Ctrl+Alt+KeyP",
  saveClip: "Alt+F8",
  toggleRecord: "Alt+F7",
};

export type RecQuality = "light" | "balanced" | "high";

export interface RecorderSettings {
  /** Replay instantâneo ligado. */
  replay: boolean;
  /** Replay só com um jogo dos perfis aberto. */
  onlyInGame: boolean;
  clipSeconds: number;
  /** 720, 1080 ou 1440 (2K). */
  maxHeight: number;
  fps: number;
  quality: RecQuality;
  systemAudio: boolean;
  /** Nome do microfone; "" = sem microfone. */
  mic: string;
  /** "" = Vídeos\Goat Filter. */
  folder: string;
}

export const DEFAULT_RECORDER: RecorderSettings = {
  replay: false,
  onlyInGame: true,
  clipSeconds: 30,
  maxHeight: 1080,
  fps: 60,
  quality: "balanced",
  systemAudio: true,
  mic: "",
  folder: "",
};

export const CLIP_CHOICES = [15, 20, 25, 30, 35, 45, 60];

export interface RecorderStatus {
  available: boolean;
  running: boolean;
  starting: boolean;
  recordingSecs: number | null;
  bufferedSecs: number;
  encoder: string | null;
  hardware: boolean;
  size: string | null;
  fps: number | null;
  error: string | null;
  folder: string;
}

export interface ClipInfo {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface PerfStatus {
  supported: boolean;
  mouseAccel: boolean | null;
  keyboardDelay: number | null;
  keyboardSpeed: number | null;
  powerHigh: boolean | null;
  gameMode: boolean | null;
  applied: boolean;
}

export interface Settings {
  theme: ThemeId;
  /** Método preferido para a faixa acima de 100%. */
  superMethod: SuperMethod;
  /** Atalhos globais ligados. */
  hotkeys: boolean;
  bindings: Bindings;
  perf: PerfTweaks;
  /** Baixa e instala versões novas sozinho (versão instalada). */
  autoUpdate: boolean;
  /** Perfis aplicados em todos os monitores. */
  applyAllMonitors: boolean;
  /** Aviso do Windows quando um perfil liga/desliga. */
  notify: boolean;
  language: Language;
  /** Apps (nome do .exe) fechados quando um jogo abre. */
  closeOnGame: string[];
  /** Biblioteca de códigos de mira do Valorant. */
  crosshairs: Crosshair[];
  /** Gravação e replay instantâneo. */
  recorder: RecorderSettings;
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
  /** Controle do monitor por DDC/CI disponível (o modelo ainda pode recusar). */
  monitorHw: boolean;
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

export type Language = "auto" | "pt" | "en";

export interface Crosshair {
  id: string;
  name: string;
  code: string;
}

/** Código de mira do Valorant: começa com "0;" (mesma regra do núcleo). */
export const isCrosshairCode = (c: string) => {
  const x = c.trim();
  return x.length <= 400 && x.startsWith("0;") && /^[A-Za-z0-9;.\-]+$/.test(x);
};

export interface DisplayMode {
  width: number;
  height: number;
  hz: number;
  maxHz: number;
  rates: number[];
}

export interface MonitorMode {
  monitorId: string;
  name: string;
  mode: DisplayMode | null;
}

export interface WindowsTweaks {
  /** Gravação em segundo plano do Xbox ligada? */
  gameDvr: boolean | null;
  /** Agendamento de GPU por hardware ligado? */
  hags: boolean | null;
}

export interface HeavyApp {
  exe: string;
  name: string;
  running: boolean;
}

export interface SystemStats {
  cpuUsage: number | null;
  ramUsedGb: number | null;
  ramTotalGb: number | null;
  gpuName: string | null;
  gpuUsage: number | null;
  gpuTemp: number | null;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
}

/** Jogo encontrado nos lançadores (Steam, Epic, Riot). */
export interface FoundGame {
  id: string;
  name: string;
  executable: string;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  notes: string | null;
  installerUrl?: string | null;
  installerSha256?: string | null;
}

export interface UpdaterState {
  /** Versão já baixada e conferida, esperando instalar. */
  pending: string | null;
  /** Versão instalada (a portátil não se atualiza sozinha). */
  installed: boolean;
}

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
  bindings: DEFAULT_BINDINGS,
  perf: { mouseAccelOff: false, keyboardFast: false, highPerformancePower: false },
  autoUpdate: true,
  applyAllMonitors: false,
  notify: true,
  language: "auto",
  closeOnGame: [],
  crosshairs: [],
  recorder: DEFAULT_RECORDER,
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
