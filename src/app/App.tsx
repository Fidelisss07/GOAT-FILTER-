import { useEffect, useState } from "react";
import mascot from "../assets/cabrito-lateral.webp";
import { ThemeSwatches } from "../components/Controls";
import { BoltIcon, GearIcon, HomeIcon, LayersIcon, WinClose, WinMax, WinMin } from "../components/Icons";
import { getNative, NativeApi } from "../lib/native";
import { ThemeId } from "../lib/types";
import { Overview } from "../pages/Overview";
import { PerformancePage } from "../pages/Performance";
import { Profiles } from "../pages/Profiles";
import { SettingsPage } from "../pages/Settings";
import { Page, useStore } from "../state/store";

const logos = import.meta.glob<string>("../assets/logo/*.svg", { eager: true, query: "?url", import: "default" });
const logo = (t: ThemeId, kind: "simbolo" | "wordmark") => logos[`../assets/logo/${t}-${kind}.svg`];

const PAGES: { id: Page; title: string; Icon: typeof HomeIcon }[] = [
  { id: "overview", title: "Visão geral", Icon: HomeIcon },
  { id: "profiles", title: "Perfis", Icon: LayersIcon },
  { id: "performance", title: "Desempenho", Icon: BoltIcon },
  { id: "settings", title: "Configurações", Icon: GearIcon },
];
const HEADINGS: Record<Page, string> = {
  overview: "Digital Vibrance",
  profiles: "Perfis",
  performance: "Desempenho",
  settings: "Configurações",
};

export function App() {
  const s = useStore();
  const [native, setNative] = useState<NativeApi | null>(null);
  const theme = s.settings.theme;

  useEffect(() => {
    void s.init().catch((e) => s.showToast({ kind: "error", text: String(e) }));
    void getNative().then(setNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand" aria-label="Goat Filter" data-tauri-drag-region>
          <img className="symbol" src={logo(theme, "simbolo")} alt="" />
          <img className="wordmark" src={logo(theme, "wordmark")} alt="goat filter" />
        </div>

        <nav className="nav" aria-label="Navegação principal">
          {PAGES.map(({ id, title, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={s.page === id ? "page" : undefined}
              onClick={() => s.setPage(id)}
            >
              <Icon />
              {title}
            </button>
          ))}
        </nav>

        {/* Decorativo: não recebe cliques nem é lido por leitores de tela. */}
        <div className="mascot" aria-hidden>
          <img src={mascot} alt="" draggable={false} />
        </div>

        <div className="theme-block">
          <h2 id="tema-label">Tema</h2>
          <ThemeSwatches value={theme} onChange={s.setTheme} />
        </div>
      </aside>

      <main className="main">
        <header className="titlebar" data-tauri-drag-region>
          {s.capabilities.demo && s.loaded && (
            <span className="demo-banner" data-tauri-drag-region>
              Modo demonstração — nenhuma cor do sistema é alterada
            </span>
          )}
          <div className="winctl">
            <button type="button" aria-label="Minimizar" onClick={() => native?.window.minimize()}><WinMin /></button>
            <button type="button" aria-label="Maximizar" onClick={() => native?.window.toggleMaximize()}><WinMax /></button>
            <button type="button" className="close" aria-label="Fechar" onClick={() => native?.window.close()}><WinClose /></button>
          </div>
        </header>

        <div className="page">
          <div className="page-head">
            <h1>{HEADINGS[s.page]}</h1>
          </div>
          {s.loaded && s.page === "overview" && <Overview />}
          {s.loaded && s.page === "profiles" && <Profiles />}
          {s.loaded && s.page === "performance" && <PerformancePage />}
          {s.loaded && s.page === "settings" && <SettingsPage />}
        </div>
      </main>

      {s.toast && (
        <div className={`toast ${s.toast.kind}`} role="status">
          {s.toast.text}
        </div>
      )}
    </div>
  );
}
