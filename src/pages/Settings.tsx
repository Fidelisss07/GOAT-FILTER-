import { MonitorSelect, ToggleRow } from "../components/Controls";
import { CheckIcon, MonitorGearIcon, MonitorIcon, PowerIcon } from "../components/Icons";
import { THEMES, ThemeId } from "../lib/types";
import { useStore } from "../state/store";

// Ordem desta tela segue o mockup: Violeta, Rosa, Amarelo.
const ORDER: ThemeId[] = ["roxo", "rosa", "amarelo"];

export function SettingsPage() {
  const s = useStore();
  const st = s.settings;
  const demo = s.capabilities.demo;
  const defaultMonitor =
    s.monitors.find((m) => m.id === st.defaultMonitor)?.id ?? s.monitors.find((m) => m.primary)?.id ?? null;

  return (
    <div className="settings">
      <section className="card set-card appearance" aria-label="Aparência">
        <div className="ico"><MonitorIcon /></div>
        <div className="txt">
          <h2>Aparência</h2>
          <p>Escolha o tema visual do aplicativo.</p>
        </div>
        <div className="ctl" role="radiogroup" aria-label="Tema do aplicativo">
          {ORDER.map((id) => {
            const t = THEMES.find((x) => x.id === id)!;
            const on = st.theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`btn theme-btn ${on ? "primary" : ""}`}
                onClick={() => s.setTheme(id)}
              >
                {on && <CheckIcon />}
                {t.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card set-card" aria-label="Inicialização">
        <div className="ico"><PowerIcon /></div>
        <div className="txt">
          <h2>Inicialização</h2>
          <p>Defina o comportamento do aplicativo na inicialização do sistema.</p>
        </div>
        <div className="ctl">
          <ToggleRow
            label="Iniciar com o Windows"
            checked={st.startWithWindows}
            onChange={(v) => s.updateSettings({ startWithWindows: v })}
            extra={demo ? <DemoTag /> : null}
          />
          <ToggleRow
            label="Minimizar para a bandeja"
            checked={st.minimizeToTray}
            onChange={(v) => s.updateSettings({ minimizeToTray: v })}
            extra={demo ? <DemoTag /> : null}
          />
        </div>
      </section>

      <section className="card set-card" aria-label="Monitor e ajustes">
        <div className="ico"><MonitorGearIcon /></div>
        <div className="txt">
          <h2>Monitor e ajustes</h2>
          <p>Selecione o monitor de aplicação e defina ajustes de funcionamento.</p>
        </div>
        <div className="ctl">
          <MonitorSelect
            label="Monitor padrão"
            monitors={s.monitors}
            value={defaultMonitor}
            onChange={(id) => s.updateSettings({ defaultMonitor: id })}
          />
          <ToggleRow
            label="Restaurar cores ao sair"
            checked={st.restoreOnExit}
            onChange={(v) => s.updateSettings({ restoreOnExit: v })}
            extra={demo ? <DemoTag /> : null}
          />
        </div>
      </section>
    </div>
  );
}

function DemoTag() {
  return <span className="pill">demonstração</span>;
}
