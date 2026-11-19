/**
 * Ponte entre a interface e o núcleo nativo (Rust/Tauri).
 * Fora do Tauri (navegador, testes) usa um modo demonstração que NÃO mexe em nada
 * do sistema: só simula monitores e guarda as preferências no localStorage.
 */
import {
  Capabilities,
  ClipInfo,
  DiagReport,
  DEFAULT_RECORDER,
  DEFAULT_SETTINGS,
  RecorderStatus,
  CacheReport,
  Resolution,
  HistoryView,
  DEFAULT_TUNING,
  FoundGame,
  HeavyApp,
  MonitorHwState,
  MonitorMode,
  SystemStats,
  WindowsTweaks,
  PerfStatus,
  UpdateInfo,
  UpdaterState,
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
  updaterState(): Promise<UpdaterState>;
  installUpdateNow(): Promise<void>;
  /** Baixa (se preciso), instala e reabre o app. */
  updateNow(): Promise<void>;
  onUpdateProgress(cb: (percent: number) => void): Promise<() => void>;
  onUpdateReady(cb: (version: string) => void): Promise<() => void>;
  appVersion(): Promise<string>;
  checkUpdate(): Promise<UpdateInfo>;
  openRelease(url: string | null): Promise<void>;
  openLogs(): Promise<void>;
  onUpdate(cb: (u: UpdateInfo) => void): Promise<() => void>;
  /** Abre o jogo do perfil (Valorant pelo Riot Client). */
  launchGame(profileId: string): Promise<void>;
  displayModes(): Promise<MonitorMode[]>;
  setRefreshRate(monitorId: string, hz: number): Promise<void>;
  windowsTweaks(): Promise<WindowsTweaks>;
  setGameDvr(on: boolean): Promise<WindowsTweaks>;
  /** Pede permissão de administrador; vale depois de reiniciar o PC. */
  requestHags(on: boolean): Promise<void>;
  heavyApps(): Promise<HeavyApp[]>;
  closeAppsNow(names: string[]): Promise<number>;
  systemStats(): Promise<SystemStats>;
  /** Mede (apply=false) ou apaga arquivos temporários e cache de shaders. */
  cleanCaches(apply: boolean): Promise<CacheReport>;
  gameHistory(): Promise<HistoryView>;
  /** Resoluções para jogar esticado no monitor do jogo. */
  stretchOptions(): Promise<Resolution[]>;
  /** Estica por 10 s para conferir. */
  testStretch(width: number, height: number): Promise<void>;
  /** Desfaz cores, ajustes do Windows e para a gravação. */
  resetEverything(): Promise<void>;
  /** Backup completo das preferências. false = cancelado. */
  exportSettings(): Promise<boolean>;
  importSettings(): Promise<Settings | null>;
  onSettings(cb: (s: Settings) => void): Promise<() => void>;
  openWindowsSettings(page: string): Promise<void>;
  recorderStatus(): Promise<RecorderStatus>;
  /** Salva os últimos segundos; devolve o caminho do arquivo. */
  saveClip(seconds?: number): Promise<string>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<string>;
  listClips(): Promise<ClipInfo[]>;
  openClip(path: string): Promise<void>;
  /** Mostra o arquivo na pasta (ou abre a pasta dos clipes). */
  revealClip(path?: string): Promise<void>;
  deleteClip(path: string): Promise<void>;
  listMicrophones(): Promise<string[]>;
  /** Grava alguns segundos e confere imagem, som do PC e microfone. */
  testRecording(): Promise<DiagReport>;
  /** Miniatura do clipe (data URL) ou null. */
  clipThumbnail(path: string): Promise<string | null>;
  clipMarkers(path: string): Promise<number[]>;
  renameClip(path: string, name: string): Promise<string>;
  trimClip(path: string, start: number, end: number): Promise<string>;
  compressClip(path: string, mb: number): Promise<string>;
  verticalClip(path: string): Promise<string>;
  sendClipDiscord(path: string): Promise<void>;
  addMarker(): Promise<number>;
  /** Endereço para o player do editor (null fora do app). */
  videoSrc(path: string): Promise<string | null>;
  pickFolder(current: string): Promise<string | null>;
  onClipsChanged(cb: () => void): Promise<() => void>;
  /** Procura jogos competitivos instalados (Steam, Epic, Riot). */
  findGames(): Promise<FoundGame[]>;
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
    findGames: () => invoke<FoundGame[]>("find_games"),
    launchGame: (profileId) => invoke<void>("launch_game", { profileId }),
    displayModes: () => invoke<MonitorMode[]>("display_modes"),
    setRefreshRate: (monitorId, hz) => invoke<void>("set_refresh_rate", { monitorId, hz }),
    windowsTweaks: () => invoke<WindowsTweaks>("windows_tweaks"),
    setGameDvr: (on) => invoke<WindowsTweaks>("set_game_dvr", { on }),
    requestHags: (on) => invoke<void>("request_hags", { on }),
    heavyApps: () => invoke<HeavyApp[]>("heavy_apps"),
    closeAppsNow: (names) => invoke<number>("close_apps_now", { names }),
    systemStats: () => invoke<SystemStats>("system_stats"),
    cleanCaches: (apply) => invoke<CacheReport>("clean_caches", { apply }),
    gameHistory: () => invoke<HistoryView>("game_history", { offsetMinutes: -new Date().getTimezoneOffset() }),
    resetEverything: () => invoke<void>("reset_everything"),
    stretchOptions: () => invoke<Resolution[]>("stretch_options"),
    testStretch: (width, height) => invoke<void>("test_stretch", { width, height }),
    exportSettings: async () => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: "goat-filter-backup.json", filters: [{ name: "Backup do Goat Filter", extensions: ["json"] }] });
      if (!path) return false;
      await invoke("export_settings", { path });
      return true;
    },
    importSettings: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: "Backup do Goat Filter", extensions: ["json"] }] });
      return typeof path === "string" ? invoke<Settings>("import_settings", { path }) : null;
    },
    onSettings: (cb) => listen<Settings>("settings-changed", (e) => cb(e.payload)),
    openWindowsSettings: (page) => invoke<void>("open_windows_settings", { page }),
    recorderStatus: () => invoke<RecorderStatus>("recorder_status"),
    saveClip: (seconds) => invoke<string>("save_clip", { seconds: seconds ?? null }),
    startRecording: () => invoke<void>("start_recording"),
    stopRecording: () => invoke<string>("stop_recording"),
    listClips: () => invoke<ClipInfo[]>("list_clips"),
    openClip: (path) => invoke<void>("open_clip", { path }),
    revealClip: (path) => invoke<void>("reveal_clip", { path: path ?? null }),
    deleteClip: (path) => invoke<void>("delete_clip", { path }),
    listMicrophones: () => invoke<string[]>("list_microphones"),
    testRecording: () => invoke<DiagReport>("test_recording"),
    clipThumbnail: (path) => invoke<string | null>("clip_thumbnail", { path }),
    clipMarkers: (path) => invoke<number[]>("clip_markers", { path }),
    renameClip: (path, name) => invoke<string>("rename_clip", { path, name }),
    trimClip: (path, start, end) => invoke<string>("trim_clip", { path, start, end }),
    compressClip: (path, mb) => invoke<string>("compress_clip", { path, mb }),
    verticalClip: (path) => invoke<string>("vertical_clip", { path }),
    sendClipDiscord: (path) => invoke<void>("send_clip_discord", { path }),
    addMarker: () => invoke<number>("add_marker"),
    videoSrc: async (path) => {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      await invoke("allow_clip_folder");
      return convertFileSrc(path);
    },
    pickFolder: async (current) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({ directory: true, multiple: false, defaultPath: current || undefined });
      return typeof r === "string" ? r : null;
    },
    onClipsChanged: (cb) => listen("clips-changed", () => cb()),
    perfStatus: () => invoke<PerfStatus>("perf_status"),
    setGameMode: (on) => invoke<PerfStatus>("set_game_mode", { on }),
    updaterState: () => invoke<UpdaterState>("updater_state"),
    installUpdateNow: () => invoke<void>("install_update_now"),
    updateNow: () => invoke<void>("update_now"),
    onUpdateProgress: (cb) => listen<{ percent: number }>("update-progress", (e) => cb(e.payload.percent)),
    onUpdateReady: (cb) => listen<string>("update-ready", (e) => cb(e.payload)),
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
      s.recorder = { ...DEFAULT_RECORDER, ...s.recorder };
      s.profiles = s.profiles.map((p) => ({ ...p, focusOnly: p.focusOnly ?? false, stretch: p.stretch ?? null, tuning: { ...DEFAULT_TUNING, ...p.tuning } }));
      return s;
    }
  } catch {
    /* sem storage: segue com o padrão */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function createDemoApi(): NativeApi {
  const demoRec: { recording: number | null; clips: ClipInfo[] } = { recording: null, clips: [] };
  const demoCache = { cleaned: false };
  const demoDerive = (path: string, tag: string, size: number) => {
    const c = demoRec.clips.find((x) => x.path === path);
    if (!c) throw new Error("Clipe não encontrado.");
    const name = `${c.name.replace(/\.mp4$/, "")} (${tag}).mp4`;
    demoRec.clips.unshift({ name, path: `demo/${name}`, size, modified: Date.now() });
    return `demo/${name}`;
  };
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
  const demoMode = { width: 1920, height: 1080, hz: 60, maxHz: 144, rates: [60, 120, 144] };
  const demoTweaks = { gameDvr: true, hags: false };
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
    launchGame: async () => {},
    recorderStatus: async () => {
      const r = loadDemoSettings().recorder;
      const on = r.replay || demoRec.recording != null;
      return {
        available: true,
        running: on,
        starting: false,
        recordingSecs: demoRec.recording == null ? null : Math.round((Date.now() - demoRec.recording) / 1000),
        bufferedSecs: on ? Math.max(r.clipSeconds, 60) : 0,
        encoder: on ? "NVIDIA NVENC" : null,
        hardware: on,
        size: on ? (r.maxHeight >= 1440 ? "2560x1440" : r.maxHeight === 720 ? "1280x720" : "1920x1080") : null,
        fps: on ? r.fps : null,
        error: null,
        folder: r.folder || "C:\\Users\\voce\\Videos\\Goat Filter",
      };
    },
    saveClip: async (seconds) => {
      const r = loadDemoSettings().recorder;
      if (!r.replay) throw new Error("O replay não está ligado agora.");
      const name = `Clipe ${seconds ?? r.clipSeconds}s ${demoRec.clips.length + 1}.mp4`;
      demoRec.clips.unshift({ name, path: `demo/${name}`, size: (seconds ?? r.clipSeconds) * 2_000_000, modified: Date.now() });
      return `demo/${name}`;
    },
    startRecording: async () => {
      demoRec.recording = Date.now();
    },
    stopRecording: async () => {
      if (demoRec.recording == null) throw new Error("Nenhuma gravação em andamento.");
      const secs = Math.max(1, Math.round((Date.now() - demoRec.recording) / 1000));
      demoRec.recording = null;
      const name = `Gameplay ${demoRec.clips.length + 1}.mp4`;
      demoRec.clips.unshift({ name, path: `demo/${name}`, size: secs * 2_000_000, modified: Date.now() });
      return `demo/${name}`;
    },
    listClips: async () => demoRec.clips.map((c) => ({ ...c })),
    openClip: async () => {},
    revealClip: async () => {},
    deleteClip: async (path) => {
      demoRec.clips = demoRec.clips.filter((c) => c.path !== path);
    },
    listMicrophones: async () => ["Microfone (Realtek(R) Audio)", "Headset (HyperX Cloud II)"],
    testRecording: async () => ({
      items: [
        { name: "Imagem", ok: true, detail: "NVIDIA NVENC · 1920x1080 · monitor \\\\.\\DISPLAY1 (saída 0) · brilho 62" },
        { name: "Som do PC", ok: true, detail: "48000 Hz · 2 canais · pico 24%" },
        { name: "Microfone", ok: true, detail: "sem microfone" },
      ],
      text: "Goat Filter (demo) — teste de gravação",
    }),
    cleanCaches: async (apply) => {
      const groups = demoCache.cleaned
        ? []
        : [
            { name: "Arquivos temporários", files: 412, bytes: 1_240_000_000 },
            { name: "Cache de shaders da NVIDIA", files: 38, bytes: 310_000_000 },
          ];
      const bytes = groups.reduce((a, g) => a + g.bytes, 0);
      if (apply) demoCache.cleaned = true;
      return { groups, bytes, freed: apply ? bytes : 0 };
    },
    stretchOptions: async () => [
      { width: 1440, height: 1080, maxHz: 144, aspect: "4:3" },
      { width: 1280, height: 960, maxHz: 144, aspect: "4:3" },
      { width: 1024, height: 768, maxHz: 144, aspect: "4:3" },
      { width: 1280, height: 1024, maxHz: 75, aspect: "5:4" },
      { width: 1680, height: 1050, maxHz: 120, aspect: "16:10" },
    ],
    testStretch: async () => {},
    resetEverything: async () => {
      for (const m of monitors) m.current = m.original;
    },
    exportSettings: async () => true,
    importSettings: async () => null,
    onSettings: async () => () => {},
    gameHistory: async () => {
      const now = Date.now();
      const s = (h: number, mins: number, clips: number, t: number) => ({ game: "Valorant", start: now - h * 3_600_000, end: now - h * 3_600_000 + mins * 60_000, clips, maxGpuTemp: t });
      return {
        summary: { weekMinutes: 345, weekSessions: 5, weekClips: 9, weekMaxTemp: 78, days: [40, 0, 95, 60, 0, 110, 40] },
        recent: [s(3, 40, 2, 74), s(26, 110, 4, 78), s(50, 60, 1, 72)],
      };
    },
    clipThumbnail: async () => null,
    clipMarkers: async (path) => (path.includes("Gameplay") ? [4.2, 11.5] : []),
    renameClip: async (path, name) => {
      const c = demoRec.clips.find((x) => x.path === path);
      if (!c) throw new Error("Clipe não encontrado.");
      const clean = name.trim().replace(/\.mp4$/i, "").replace(/[\\/:*?"<>|]/g, "");
      if (!clean) throw new Error("Nome inválido.");
      if (demoRec.clips.some((x) => x !== c && x.name === `${clean}.mp4`)) throw new Error("Já existe um clipe com esse nome.");
      c.name = `${clean}.mp4`;
      c.path = `demo/${c.name}`;
      return c.path;
    },
    trimClip: async (path, start, end) => demoDerive(path, "corte", (end - start) * 2_000_000),
    compressClip: async (path, mb) => demoDerive(path, `${mb} MB`, mb * 900_000),
    verticalClip: async (path) => demoDerive(path, "vertical", 12_000_000),
    sendClipDiscord: async () => {
      if (!loadDemoSettings().recorder.discordWebhook) throw new Error("Configure o webhook do Discord na aba Gravação.");
    },
    addMarker: async () => {
      if (demoRec.recording == null) throw new Error("Os marcadores funcionam durante a gravação de gameplay.");
      return Math.round((Date.now() - demoRec.recording) / 100) / 10;
    },
    videoSrc: async () => null,
    pickFolder: async () => null,
    onClipsChanged: async () => () => {},
    displayModes: async () => [
      { monitorId: "demo-1", name: "Monitor principal", mode: { ...demoMode } },
      { monitorId: "demo-2", name: "Monitor 2", mode: { width: 1920, height: 1080, hz: 60, maxHz: 60, rates: [60] } },
    ],
    setRefreshRate: async (_id, hz) => {
      demoMode.hz = hz;
    },
    windowsTweaks: async () => ({ ...demoTweaks }),
    setGameDvr: async (on) => {
      demoTweaks.gameDvr = on;
      return { ...demoTweaks };
    },
    requestHags: async () => {},
    heavyApps: async () => [
      { exe: "chrome.exe", name: "Google Chrome", running: true },
      { exe: "onedrive.exe", name: "OneDrive", running: true },
      { exe: "firefox.exe", name: "Firefox", running: false },
    ],
    closeAppsNow: async (names) => names.length,
    systemStats: async () => ({
      cpuUsage: 18 + Math.round(Math.random() * 6),
      ramUsedGb: 9.4,
      ramTotalGb: 32,
      gpuName: "NVIDIA GeForce RTX 3090",
      gpuUsage: 7,
      gpuTemp: 41,
      vramUsedGb: 1.9,
      vramTotalGb: 24,
    }),
    openWindowsSettings: async () => {},
    findGames: async () => [
      { id: "valorant", name: "Valorant", executable: "C:\\Riot Games\\VALORANT\\live\\VALORANT.exe", source: "Riot" },
      { id: "cs2", name: "Counter-Strike 2", executable: "D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe", source: "Steam" },
      { id: "fortnite", name: "Fortnite", executable: "C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe", source: "Epic" },
    ],
    perfStatus: async () => ({ ...demoPerf }),
    setGameMode: async (on) => {
      demoPerf.gameMode = on;
      return { ...demoPerf };
    },
    updaterState: async () => ({ pending: null, installed: true }),
    installUpdateNow: async () => {},
    updateNow: async () => {},
    onUpdateProgress: async () => () => {},
    onUpdateReady: async () => () => {},
    appVersion: async () => "1.2.0",
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
