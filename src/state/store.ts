import { create } from "zustand";
import { getNative } from "../lib/native";
import {
  Capabilities,
  DEFAULT_SETTINGS,
  DEFAULT_TUNING,
  GameStatus,
  MonitorInfo,
  Profile,
  Settings,
  ThemeId,
  VALORANT_ID,
} from "../lib/types";

export type Page = "overview" | "profiles" | "settings";

export interface Toast {
  kind: "ok" | "error" | "info";
  text: string;
}

export interface ProfileErrors {
  name?: string;
  executable?: string;
}

interface State {
  loaded: boolean;
  page: Page;
  capabilities: Capabilities;
  monitors: MonitorInfo[];
  settings: Settings;
  game: GameStatus;
  selectedMonitorId: string | null;
  /** Valor editado no slider por monitor (ainda não aplicado). */
  edited: Record<string, number>;
  busy: boolean;
  toast: Toast | null;

  selectedProfileId: string | null;
  draft: Profile | null;
  draftErrors: ProfileErrors;

  init(): Promise<void>;
  setPage(p: Page): void;
  setTheme(t: ThemeId): Promise<void>;
  selectMonitor(id: string): void;
  setEdited(v: number): void;
  apply(): Promise<void>;
  restore(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  setValorantFlag(key: "applyOnOpen" | "restoreOnClose", v: boolean): Promise<void>;
  selectProfile(id: string): void;
  newProfile(): void;
  updateDraft(patch: Partial<Profile>): void;
  saveDraft(): Promise<boolean>;
  deleteProfile(id: string): Promise<void>;
  /** Aplica o rascunho do perfil no monitor padrão, sem salvar. */
  testDraft(): Promise<void>;
  exportProfiles(): Promise<void>;
  importProfiles(): Promise<void>;
  showToast(t: Toast): void;
  monitorsChanged(list: MonitorInfo[]): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStore = create<State>((set, get) => ({
  loaded: false,
  page: "overview",
  capabilities: { demo: true, superMethod: "none", superReason: null, methods: [], curves: false, monitorHw: false },
  monitors: [],
  settings: DEFAULT_SETTINGS,
  game: { state: "idle", profileId: null, message: null },
  selectedMonitorId: null,
  edited: {},
  busy: false,
  toast: null,
  selectedProfileId: VALORANT_ID,
  draft: null,
  draftErrors: {},

  async init() {
    const n = await getNative();
    const snap = await n.getSnapshot();
    const monitors = snap.monitors;
    const pick =
      monitors.find((m) => m.id === snap.settings.defaultMonitor) ??
      monitors.find((m) => m.primary) ??
      monitors[0];
    const valorant = snap.settings.profiles.find((p) => p.id === VALORANT_ID);
    const edited: Record<string, number> = {};
    for (const m of monitors) edited[m.id] = m.current ?? valorant?.vibrance ?? 50;
    // Estado de demonstração do mockup: 75% no monitor principal.
    if (snap.capabilities.demo && pick && valorant) edited[pick.id] = valorant.vibrance;
    const first = snap.settings.profiles[0] ?? null;
    set({
      loaded: true,
      capabilities: snap.capabilities,
      monitors,
      settings: snap.settings,
      game: snap.game,
      selectedMonitorId: pick?.id ?? null,
      edited,
      selectedProfileId: first?.id ?? null,
      draft: first ? { ...first } : null,
    });
    n.onGameStatus((game) => set({ game }));
    n.onMonitors((list) => get().monitorsChanged(list));
    n.onNotice((t) => get().showToast(t));
  },

  setPage: (page) => set({ page }),

  async setTheme(theme) {
    // O tema só muda a interface; nunca mexe em ajustes de exibição.
    await get().updateSettings({ theme });
  },

  selectMonitor: (id) => set({ selectedMonitorId: id }),

  setEdited(v) {
    const id = get().selectedMonitorId;
    if (!id) return;
    set({ edited: { ...get().edited, [id]: Math.round(v) } });
  },

  async apply() {
    const { selectedMonitorId: id, edited } = get();
    if (!id) return;
    set({ busy: true });
    try {
      const n = await getNative();
      const m = await n.applyVibrance(id, edited[id]);
      replaceMonitor(set, get, m);
      get().showToast({ kind: "ok", text: `Aplicado: ${m.current ?? edited[id]}%` });
    } catch (e) {
      get().showToast({ kind: "error", text: `Não foi possível aplicar: ${errMsg(e)}` });
    } finally {
      set({ busy: false });
    }
  },

  async restore() {
    const id = get().selectedMonitorId;
    if (!id) return;
    set({ busy: true });
    try {
      const n = await getNative();
      const m = await n.restoreMonitor(id);
      replaceMonitor(set, get, m);
      if (m.current != null) set({ edited: { ...get().edited, [id]: m.current } });
      get().showToast({
        kind: "ok",
        text: m.driverDefault != null ? "Padrão do driver restaurado." : "Valor anterior restaurado.",
      });
    } catch (e) {
      get().showToast({ kind: "error", text: `Não foi possível restaurar: ${errMsg(e)}` });
    } finally {
      set({ busy: false });
    }
  },

  async updateSettings(patch) {
    const prev = get().settings;
    const next = { ...prev, ...patch };
    set({ settings: next });
    try {
      const n = await getNative();
      const effective = await n.saveSettings(next);
      set({ settings: effective });
      if (patch.startWithWindows !== undefined && effective.startWithWindows !== patch.startWithWindows) {
        get().showToast({ kind: "error", text: "O Windows não aceitou alterar a inicialização automática." });
      }
      if (patch.superMethod !== undefined) {
        const snap = await n.getSnapshot();
        set({ capabilities: snap.capabilities, monitors: snap.monitors });
        if (effective.superMethod !== patch.superMethod) {
          get().showToast({ kind: "error", text: "Não foi possível usar esse método neste PC." });
        } else {
          get().showToast({ kind: "ok", text: "Método do Super Vibrance alterado." });
        }
      }
    } catch (e) {
      set({ settings: prev });
      get().showToast({ kind: "error", text: `Não foi possível salvar: ${errMsg(e)}` });
    }
  },

  async setValorantFlag(key, v) {
    const profiles = get().settings.profiles.map((p) => (p.id === VALORANT_ID ? { ...p, [key]: v } : p));
    await get().updateSettings({ profiles });
    const d = get().draft;
    if (d?.id === VALORANT_ID) set({ draft: { ...d, [key]: v } });
  },

  selectProfile(id) {
    const p = get().settings.profiles.find((x) => x.id === id);
    if (p) set({ selectedProfileId: id, draft: { ...p }, draftErrors: {} });
  },

  newProfile() {
    set({
      selectedProfileId: null,
      draft: {
        id: `perfil-${Date.now().toString(36)}`,
        name: "",
        executable: "",
        vibrance: 75,
        applyOnOpen: true,
        restoreOnClose: true,
        tuning: { ...DEFAULT_TUNING },
        focusOnly: false,
      },
      draftErrors: {},
    });
  },

  updateDraft(patch) {
    const d = get().draft;
    if (!d) return;
    const errs = { ...get().draftErrors };
    if ("name" in patch) delete errs.name;
    if ("executable" in patch) delete errs.executable;
    set({ draft: { ...d, ...patch }, draftErrors: errs });
  },

  async saveDraft() {
    const d = get().draft;
    if (!d) return false;
    const n = await getNative();
    const errors: ProfileErrors = {};
    const name = d.name.trim();
    const exe = d.executable.trim();
    if (!name) errors.name = "Informe um nome para o perfil.";
    else if (get().settings.profiles.some((p) => p.id !== d.id && p.name.toLowerCase() === name.toLowerCase()))
      errors.name = "Já existe um perfil com esse nome.";
    if (!exe) errors.executable = "Informe o executável do jogo.";
    else if (!/\.exe$/i.test(exe)) errors.executable = "O caminho precisa terminar em .exe.";
    set({ draftErrors: errors });
    if (errors.name || errors.executable) return false;
    // O jogo é reconhecido pelo nome do .exe; caminho errado só gera aviso.
    const missing = !(await n.executableExists(exe));
    const saved: Profile = { ...d, name, executable: exe };
    const list = get().settings.profiles;
    const profiles = list.some((p) => p.id === d.id)
      ? list.map((p) => (p.id === d.id ? saved : p))
      : [...list, saved];
    await get().updateSettings({ profiles });
    set({ selectedProfileId: saved.id, draft: { ...saved } });
    get().showToast(
      missing
        ? { kind: "info", text: `Perfil "${name}" salvo. Aviso: não achei o arquivo nesse caminho, mas o jogo ainda será reconhecido pelo nome do .exe.` }
        : { kind: "ok", text: `Perfil "${name}" salvo.` },
    );
    return true;
  },

  async deleteProfile(id) {
    if (id === VALORANT_ID) return;
    const profiles = get().settings.profiles.filter((p) => p.id !== id);
    await get().updateSettings({ profiles });
    get().selectProfile(VALORANT_ID);
  },

  async testDraft() {
    const d = get().draft;
    const s = get();
    const id =
      s.monitors.find((m) => m.id === s.settings.defaultMonitor)?.id ??
      s.monitors.find((m) => m.primary)?.id ??
      s.monitors[0]?.id;
    if (!d || !id) return;
    try {
      const n = await getNative();
      const m = await n.applyTuned(id, d.vibrance, d.tuning);
      set({ monitors: get().monitors.map((x) => (x.id === m.id ? m : x)), edited: { ...get().edited, [id]: m.current ?? d.vibrance } });
      get().showToast({ kind: "ok", text: `Testando "${d.name || "perfil"}" no monitor padrão. Use Restaurar padrão para voltar.` });
    } catch (e) {
      get().showToast({ kind: "error", text: errMsg(e) });
    }
  },

  async exportProfiles() {
    try {
      const n = await getNative();
      const count = await n.exportProfiles();
      if (count != null) get().showToast({ kind: "ok", text: `${count} perfil(is) exportado(s).` });
    } catch (e) {
      get().showToast({ kind: "error", text: errMsg(e) });
    }
  },

  async importProfiles() {
    try {
      const n = await getNative();
      const s = await n.importProfiles();
      if (!s) return;
      set({ settings: s });
      get().selectProfile(get().selectedProfileId ?? VALORANT_ID);
      get().showToast({ kind: "ok", text: "Perfis importados." });
    } catch (e) {
      get().showToast({ kind: "error", text: errMsg(e) });
    }
  },

  showToast(t) {
    set({ toast: t });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },

  monitorsChanged(list) {
    const s = get();
    const stillThere = list.some((m) => m.id === s.selectedMonitorId);
    const edited = { ...s.edited };
    for (const m of list) {
      const prev = s.monitors.find((x) => x.id === m.id);
      // Mudou por fora (atalho, perfil do jogo, bandeja): o slider acompanha.
      if (edited[m.id] === undefined || (prev && prev.current !== m.current && m.current != null)) {
        edited[m.id] = m.current ?? 50;
      }
    }
    set({
      monitors: list,
      edited,
      selectedMonitorId: stillThere ? s.selectedMonitorId : (list.find((m) => m.primary) ?? list[0])?.id ?? null,
    });
    if (!stillThere && s.selectedMonitorId) {
      s.showToast({ kind: "info", text: "Monitor desconectado. Selecionamos outro disponível." });
    }
  },
}));

function replaceMonitor(
  set: (p: Partial<State>) => void,
  get: () => State,
  m: MonitorInfo,
) {
  set({ monitors: get().monitors.map((x) => (x.id === m.id ? m : x)) });
}

/** Utilitários de leitura. */
export const selectedMonitor = (s: State) => s.monitors.find((m) => m.id === s.selectedMonitorId) ?? null;
export const valorantProfile = (s: State) => s.settings.profiles.find((p) => p.id === VALORANT_ID) ?? null;
