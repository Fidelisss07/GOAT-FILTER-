/**
 * Ponte entre a interface e o núcleo nativo (Rust/Tauri).
 * Fora do Tauri (navegador, testes) usa um modo demonstração que NÃO mexe em nada
 * do sistema: só simula monitores e guarda as preferências no localStorage.
 */
import {
  Capabilities,
  DEFAULT_SETTINGS,
  DEFAULT_TUNING,
  MonitorHwState,
  PerfStatus,
  UpdateInfo,
  Tuning,
  GameStatus,
  MonitorInfo,
  Notice,
  Settings,
  Snapshot,
} from "./types";

export interface NativeApi {
  getSnapshot(): Promise<Snapshot>;
  applyVibrance(monitorId: string, percent: number): Promise<MonitorInfo>;
  /** Vibrance + ajustes finos (botão "Testar agora" do perfil). */
  applyTuned(monitorId: string, percent: number, tuning: Tuning): Promise<MonitorInfo>;
  /** Lê o próprio monitor por DDC/CI (lento). */
  monitorHw(monitorId: string): Promise<MonitorHwState>;
  perfStatus(): Promise<PerfStatus>;
  setGameMode(on: boolean): Promise<PerfStatus>;
  appVersion(): Promise<string>;
  checkUpdate(): Promise<UpdateInfo>;
  openRelease(url: string | null): Promise<void>;
  openLogs(): Promise<void>;
  onUpdate(cb: (u: UpdateInfo) => void): Promise<() => void>;
  /** Procura o VALORANT.exe nesta máquina. */
  findValorant(): Promise<string | null>;
  /** Grava os perfis em um arquivo escolhido pelo usuário. null = cancelado. */
  exportProfiles(): Promise<number | null>;
  /** Lê perfis de um arquivo; devolve as preferências atualizadas. null = cancelado. */
  importProfiles(): Promise<Settings | null>;
  /** Volta ao padrão do driver ou, se não houver, ao valor anterior. */
  restoreMonitor(monitorId: string): Promise<MonitorInfo>;
  /** Persiste e devolve as preferências efetivas (ex.: se autostart falhou). */
  saveSettings(settings: Settings): Promise<Settings>;
  executableExists(path: string): Promise<boolean>;
  pickExecutable(current: string): Promise<string | null>;
  onGameStatus(cb: (s: GameStatus) => void): Promise<() => void>;
  onMonitors(cb: (m: MonitorInfo[]) => void): Promise<() => void>;
  onNotice(cb: (n: Notice) => void): Promise<() => void>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------------------------------------------------------------------------
// Tauri
// ---------------------------------------------------------------------------

async function tauriApi(): Promise<NativeApi> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return {
    getSnapshot: () => invoke<Snapshot>("get_snapshot"),
    applyVibrance: (monitorId, percent) =>
      invoke<MonitorInfo>("apply_vibrance", { monitorId, percent }),
    applyTuned: (monitorId, percent, tuning) =>
      invoke<MonitorInfo>("apply_tuned", { monitorId, percent, tuning }),
    monitorHw: (monitorId) => invoke<MonitorHwState>("monitor_hw", { monitorId }),
    findValorant: () => invoke<string | null>("find_valorant"),
    perfStatus: () => invoke<PerfStatus>("perf_status"),
    setGameMode: (on) => invoke<PerfStatus>("set_game_mode", { on }),
    appVersion: () => invoke<string>("app_version"),
    checkUpdate: () => invoke<UpdateInfo>("check_update"),
    openRelease: (url) => invoke<void>("open_release", { url }),
    openLogs: () => invoke<void>("open_logs"),
    onUpdate: (cb) => listen<UpdateInfo>("update-available", (e) => cb(e.payload)),
    exportProfiles: async () => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "perfis.goatfilter.json",
        filters: [{ name: "Perfis do Goat Filter", extensions: ["json"] }],
      });
      return path ? invoke<number>("export_profiles", { path }) : null;
    },
    importProfiles: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: "Perfis do Goat Filter", extensions: ["json"] }] });
      return typeof path === "string" ? invoke<Settings>("import_profiles", { path }) : null;
    },
    restoreMonitor: (monitorId) => invoke<MonitorInfo>("restore_monitor", { monitorId }),
    saveSettings: (settings) => invoke<Settings>("save_settings", { settings }),
    executableExists: (path) => invoke<boolean>("executable_exists", { path }),
    pickExecutable: async (current) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({
        multiple: false,
        directory: false,
        defaultPath: current || undefined,
        filters: [{ name: "Executável", extensions: ["exe"] }],
      });
      return typeof r === "string" ? r : null;
    },
    onGameStatus: (cb) => listen<GameStatus>("game-status", (e) => cb(e.payload)),
    onMonitors: (cb) => listen<MonitorInfo[]>("monitors-changed", (e) => cb(e.payload)),
    onNotice: (cb) => listen<Notice>("notice", (e) => cb(e.payload)),
    window: {
      minimize: () => void win.minimize(),
      toggleMaximize: () => void win.toggleMaximize(),
      close: () => void win.close(),
    },
  };
}

// ---------------------------------------------------------------------------
// Demonstração
// ---------------------------------------------------------------------------

const DEMO_KEY = "goat-filter:settings";

function loadDemoSettings(): Settings {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
      s.bindings = { ...DEFAULT_SETTINGS.bindings, ...s.bindings };
      s.perf = { ...DEFAULT_SETTINGS.perf, ...s.perf };
      s.profiles = s.profiles.map((p) => ({ ...p, focusOnly: p.focusOnly ?? false, tuning: { ...DEFAULT_TUNING, ...p.tuning } }));
      return s;
    }
  } catch {
    /* sem storage: segue com o padrão */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function createDemoApi(): NativeApi {
  const monitors: MonitorInfo[] = [
    { id: "demo-1", name: "Monitor principal", primary: true, driver: "nvidia", current: 50, driverDefault: 50, original: 50, tuning: DEFAULT_TUNING },
    { id: "demo-2", name: "Monitor 2", primary: false, driver: "none", current: 50, driverDefault: null, original: 50, tuning: DEFAULT_TUNING },
  ];
  const caps: Capabilities = {
    demo: true,
    superMethod: "magnifier",
    superReason: null,
    curves: true,
    monitorHw: true,
    methods: [
      { method: "magnifier", available: true, reason: null },
      { method: "mhc2", available: true, reason: null },
    ],
  };
  const demoPerf: PerfStatus = {
    supported: true,
    mouseAccel: true,
    keyboardDelay: 1,
    keyboardSpeed: 31,
    powerHigh: false,
    gameMode: false,
    applied: false,
  };
  const find = (id: string) => {
    const m = monitors.find((x) => x.id === id);
    if (!m) throw new Error("Monitor desconectado.");
    return m;
  };
  return {
    getSnapshot: async () => ({
      capabilities: { ...caps, superMethod: loadDemoSettings().superMethod },
      monitors: structuredClone(monitors),
      settings: loadDemoSettings(),
      game: { state: "unavailable", profileId: null, message: "Modo demonstração: detecção do jogo desativada." },
    }),
    applyVibrance: async (id, percent) => {
      const m = find(id);
      m.current = percent;
      return { ...m };
    },
    applyTuned: async (id, percent, tuning) => {
      const m = find(id);
      m.current = percent;
      m.tuning = { ...tuning };
      return { ...m };
    },
    monitorHw: async (id) => (find(id).primary ? { brightness: 70, contrast: 50, saturation: null } : { brightness: null, contrast: null, saturation: null }),
    findValorant: async () => null,
    perfStatus: async () => ({ ...demoPerf }),
    setGameMode: async (on) => {
      demoPerf.gameMode = on;
      return { ...demoPerf };
    },
    appVersion: async () => "1.1.0",
    checkUpdate: async () => ({ current: "1.0.0", latest: null, available: false, url: null, notes: null }),
    openRelease: async () => {},
    openLogs: async () => {},
    onUpdate: async () => () => {},
    exportProfiles: async () => loadDemoSettings().profiles.length,
    importProfiles: async () => null,
    restoreMonitor: async (id) => {
      const m = find(id);
      m.current = m.driverDefault ?? m.original;
      m.tuning = { ...DEFAULT_TUNING };
      return { ...m };
    },
    saveSettings: async (s) => {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(s));
      } catch {
        /* ignora */
      }
      return s;
    },
    executableExists: async (p) => /\.exe$/i.test(p.trim()),
    pickExecutable: async () => null,
    onGameStatus: async () => () => {},
    onMonitors: async () => () => {},
    onNotice: async () => () => {},
    window: { minimize() {}, toggleMaximize() {}, close() {} },
  };
}

let api: Promise<NativeApi> | null = null;
export function getNative(): Promise<NativeApi> {
  if (!api) api = isTauri() ? tauriApi() : Promise.resolve(createDemoApi());
  return api;
}

/** Só para testes. */
export function setNativeForTests(n: NativeApi) {
  api = Promise.resolve(n);
}
