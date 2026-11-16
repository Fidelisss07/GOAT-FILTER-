/**
 * Ponte entre a interface e o núcleo nativo (Rust/Tauri).
 * Fora do Tauri (navegador, testes) usa um modo demonstração que NÃO mexe em nada
 * do sistema: só simula monitores e guarda as preferências no localStorage.
 */
import {
  DEFAULT_SETTINGS,
  GameStatus,
  MonitorInfo,
  Settings,
  Snapshot,
} from "./types";

export interface NativeApi {
  getSnapshot(): Promise<Snapshot>;
  applyVibrance(monitorId: string, percent: number): Promise<MonitorInfo>;
  /** Volta ao padrão do driver ou, se não houver, ao valor anterior. */
  restoreMonitor(monitorId: string): Promise<MonitorInfo>;
  /** Persiste e devolve as preferências efetivas (ex.: se autostart falhou). */
  saveSettings(settings: Settings): Promise<Settings>;
  executableExists(path: string): Promise<boolean>;
  pickExecutable(current: string): Promise<string | null>;
  onGameStatus(cb: (s: GameStatus) => void): Promise<() => void>;
  onMonitors(cb: (m: MonitorInfo[]) => void): Promise<() => void>;
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
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* sem storage: segue com o padrão */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function createDemoApi(): NativeApi {
  const monitors: MonitorInfo[] = [
    { id: "demo-1", name: "Monitor principal", primary: true, driver: "nvidia", current: 50, driverDefault: 50, original: 50 },
    { id: "demo-2", name: "Monitor 2", primary: false, driver: "none", current: 50, driverDefault: null, original: 50 },
  ];
  const find = (id: string) => {
    const m = monitors.find((x) => x.id === id);
    if (!m) throw new Error("Monitor desconectado.");
    return m;
  };
  return {
    getSnapshot: async () => ({
      capabilities: { demo: true, superMethod: "magnifier", superReason: null },
      monitors: structuredClone(monitors),
      settings: loadDemoSettings(),
      game: { state: "unavailable", profileId: null, message: "Modo demonstração: detecção do jogo desativada." },
    }),
    applyVibrance: async (id, percent) => {
      const m = find(id);
      m.current = percent;
      return { ...m };
    },
    restoreMonitor: async (id) => {
      const m = find(id);
      m.current = m.driverDefault ?? m.original;
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
