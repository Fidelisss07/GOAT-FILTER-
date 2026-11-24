import { useEffect, useState } from "react";
import { ThemeSwatches } from "../components/Controls";
import { UpdateBanner } from "../components/UpdatePanel";
import { Scene } from "../components/Scene";
import { StatusPills } from "../components/StatusPills";
import { vibranceMax } from "../components/VibranceSlider";
import { previewSaturation } from "../lib/vibrance";
import { BoltIcon, GearIcon, HomeIcon, LayersIcon, MouseIcon, RecordIcon, TargetIcon, WinClose, WinMax, WinMin } from "../components/Icons";
import { getNative, NativeApi } from "../lib/native";
import { ThemeId } from "../lib/types";
import { Overview } from "../pages/Overview";
import { PerformancePage } from "../pages/Performance";
import { Profiles } from "../pages/Profiles";
import { RecordingPage } from "../pages/Recording";
import { Welcome } from "../components/Welcome";
import { SensitivityPage } from "../pages/Sensitivity";
import { SettingsPage } from "../pages/Settings";
import { TrainingPage } from "../pages/Training";
import { useT } from "../lib/useT";
import { Page, selectedMonitor, useStore } from "../state/store";

const logos = import.meta.glob<string>("../assets/logo/*.svg", { eager: true, query: "?url", import: "default" });
const logo = (t: ThemeId, kind: "simbolo" | "wordmark") => logos[`../assets/logo/${t}-${kind}.svg`];

const PAGES: { id: Page; title: string; Icon: typeof HomeIcon }[] = [
  { id: "overview", title: "Visão geral", Icon: HomeIcon },
  { id: "profiles", title: "Perfis", Icon: LayersIcon },
  { id: "performance", title: "Desempenho", Icon: BoltIcon },
  { id: "recording", title: "Gravação", Icon: RecordIcon },
  { id: "training", title: "Treino", Icon: TargetIcon },
  { id: "sensitivity", title: "Sensibilidade", Icon: MouseIcon },
  { id: "settings", title: "Configurações", Icon: GearIcon },
];
const HEADINGS: Record<Page, string> = {
  overview: "Digital Vibrance",
  profiles: "Perfis",
  performance: "Desempenho",
  recording: "Gravação",
  training: "Treino",
  sensitivity: "Sensibilidade",
  settings: "Configurações",
};

export function App() {
  const s = useStore();
  const t = useT();
  const [native, setNative] = useState<NativeApi | null>(null);
  const theme = s.settings.theme;

  // Botões laterais do mouse fazem "voltar/avançar" no navegador interno: bloqueia.
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    window.addEventListener("mouseup", block);
    return () => window.removeEventListener("mouseup", block);
  }, []);

  useEffect(() => {
    void s.init().catch((e) => s.showToast({ kind: "error", text: String(e) }));
    void getNative().then(setNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const oled = s.settings.oled;
  useEffect(() => {
    document.documentElement.dataset.oled = oled ? "true" : "false";
  }, [oled]);

  // Fundo vivo: a cor da cena segue o vibrance escolhido (ou o aplicado, nas outras páginas).
  const monitor = selectedMonitor(s);
  const max = vibranceMax(s.capabilities);
  const shown = Math.min(monitor ? s.edited[monitor.id] ?? monitor.current ?? 50 : 50, max);
  const overview = s.page === "overview";

  return (
    <div className={`app page-${s.page}`} data-theme={theme}>
      <Scene saturation={previewSaturation(shown)} reveal={shown / 200} dim={!overview} />
      <div className="dragbar" data-tauri-drag-region />

      <header className="topbar" data-tauri-drag-region>
        <div className="glass island brand" aria-label="Goat Filter" data-tauri-drag-region>
          <img className="symbol" src={logo(theme, "simbolo")} alt="" data-tauri-drag-region />
          <img className="wordmark" src={logo(theme, "wordmark")} alt="goat filter" data-tauri-drag-region />
          <span className="brand-sep" aria-hidden />
          <ThemeSwatches value={theme} onChange={s.setTheme} />
        </div>
        <div className="topbar-right">
          <StatusPills />
          <div className="glass island winctl">
            <button type="button" aria-label={t("Minimizar")} onClick={() => native?.window.minimize()}><WinMin /></button>
            <button type="button" aria-label={t("Maximizar")} onClick={() => native?.window.toggleMaximize()}><WinMax /></button>
            <button type="button" className="close" aria-label={t("Fechar")} onClick={() => native?.window.close()}><WinClose /></button>
          </div>
        </div>
      </header>

      <UpdateBanner />

      <main className="stage">
        {overview ? (
          <div className="page-view" key="overview">
            <h1 className="sr-only">{t(HEADINGS.overview)}</h1>
            {s.loaded && <Overview />}
          </div>
        ) : (
          <div className="sheet glass" key={s.page}>
            <div className="sheet-head">
              <h1>{t(HEADINGS[s.page])}</h1>
              {s.capabilities.demo && s.loaded && <span className="demo-banner">{t("Modo demonstração — nenhuma cor do sistema é alterada")}</span>}
            </div>
            <div className="sheet-body">
              {s.loaded && s.page === "profiles" && <Profiles />}
              {s.loaded && s.page === "performance" && <PerformancePage />}
              {s.loaded && s.page === "recording" && <RecordingPage />}
              {s.loaded && s.page === "training" && <TrainingPage />}
              {s.loaded && s.page === "sensitivity" && <SensitivityPage />}
              {s.loaded && s.page === "settings" && <SettingsPage />}
            </div>
          </div>
        )}
      </main>

      <nav className="glass dock" aria-label={t("Navegação principal")}>
        {PAGES.map(({ id, title, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={s.page === id ? "page" : undefined}
            onClick={() => s.setPage(id)}
          >
            <Icon />
            <span className="dock-tip">{t(title)}</span>
          </button>
        ))}
      </nav>

      {s.toast && (
        <div className={`toast ${s.toast.kind}`} role="status">
          {s.toast.text}
        </div>
      )}
      {s.loaded && !s.settings.onboarded && <Welcome />}
    </div>
  );
}
