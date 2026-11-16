import { useEffect, useState } from "react";
import { ThemeSwatches } from "../components/Controls";
import { GearIcon, HomeIcon, LayersIcon, WinClose, WinMax, WinMin } from "../components/Icons";
import { getNative, NativeApi } from "../lib/native";
import { ThemeId } from "../lib/types";
import { Overview } from "../pages/Overview";
import { Profiles } from "../pages/Profiles";
import { SettingsPage } from "../pages/Settings";
import { Page, useStore } from "../state/store";

const logos = import.meta.glob<string>("../assets/logo/*.svg", { eager: true, query: "?url", import: "default" });
const logo = (t: ThemeId, kind: "simbolo" | "wordmark") => logos[`../assets/logo/${t}-${kind}.svg`];

const PAGES: { id: Page; title: string; Icon: typeof HomeIcon }[] = [
  { id: "overview", title: "Visão geral", Icon: HomeIcon },
  { id: "profiles", title: "Perfis", Icon: LayersIcon },
  { id: "settings", title: "Configurações", Icon: GearIcon },
];
const HEADINGS: Record<Page, string> = {
  overview: "Digital Vibrance",
  profiles: "Perfis",
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
        <div className="brand" aria-label="Goat Filter">
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

        <div className="theme-block">
          <hr />
          <h2 id="tema-label">Tema</h2>
          <ThemeSwatches value={theme} onChange={s.setTheme} />
        </div>

        <svg className="corner-bl" viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden>
          <path d="M0 4 L26 30 H220" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      </aside>

      <main className="main">
        <div className="topframe" aria-hidden>
          <svg className="seg-up" viewBox="0 0 28 56" preserveAspectRatio="none">
            <path d="M0 56 L28 27.5" fill="none" stroke="currentColor" strokeWidth="3" />
          </svg>
          <div className="seg-top" />
          <svg className="seg-down" viewBox="0 0 34 56" preserveAspectRatio="none">
            <path d="M0 27.5 L34 49.5" fill="none" stroke="currentColor" strokeWidth="3" />
          </svg>
          <div className="seg-low" />
        </div>
        {s.capabilities.demo && s.loaded && (
          <div className="demo-banner">Modo demonstração — nenhuma cor do sistema é alterada</div>
        )}

        <header className="titlebar" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{HEADINGS[s.page]}</h1>
          <div className="winctl">
            <button type="button" aria-label="Minimizar" onClick={() => native?.window.minimize()}><WinMin /></button>
            <button type="button" aria-label="Maximizar" onClick={() => native?.window.toggleMaximize()}><WinMax /></button>
            <button type="button" className="close" aria-label="Fechar" onClick={() => native?.window.close()}><WinClose /></button>
          </div>
        </header>

        <div className="page">
          {s.loaded && s.page === "overview" && <Overview />}
          {s.loaded && s.page === "profiles" && <Profiles />}
          {s.loaded && s.page === "settings" && <SettingsPage />}
        </div>

        <svg className="corner-br" viewBox="0 0 34 34" aria-hidden>
          <path d="M34 4 L8 30 H0" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      </main>

      {s.toast && (
        <div className={`toast ${s.toast.kind}`} role="status">
          {s.toast.text}
        </div>
      )}
    </div>
  );
}
