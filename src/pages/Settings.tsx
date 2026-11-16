import { MonitorSelect, ToggleRow } from "../components/Controls";
import { CheckIcon, MonitorGearIcon, MonitorIcon, PowerIcon, SparkIcon } from "../components/Icons";
import { getNative } from "../lib/native";
import { METHOD_LABEL, THEMES, ThemeId } from "../lib/types";
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

      <section className="card set-card" aria-label="Super Vibrance e atalhos">
        <div className="ico"><SparkIcon /></div>
        <div className="txt">
          <h2>Super Vibrance</h2>
          <p>Como aplicar a faixa acima de 100%.</p>
        </div>
        <div className="ctl">
          <div className="methods" role="radiogroup" aria-label="Método do Super Vibrance">
            {s.capabilities.methods.map((m) => {
              const on = st.superMethod === m.method;
              const info = METHOD_LABEL[m.method];
              return (
                <button
                  key={m.method}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!m.available}
                  className="method"
                  onClick={() => s.updateSettings({ superMethod: m.method })}
                >
                  <span className="radio" aria-hidden>{on && <CheckIcon />}</span>
                  <span className="body">
                    <strong>{info.title}</strong>
                    <span>{m.available ? info.detail : `Indisponível: ${m.reason ?? "não suportado"}`}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="note">Atalhos de teclado e ajustes de mouse e teclado ficam na aba Desempenho.</p>
        </div>
      </section>

      <About />
    </div>
  );
}

const logos = import.meta.glob<string>("../assets/logo/*-simbolo.svg", { eager: true, query: "?url", import: "default" });

function About() {
  const s = useStore();
  const u = s.update;
  return (
    <section className="card set-card about" aria-label="Sobre">
      <div className="ico">
        <img src={logos[`../assets/logo/${s.settings.theme}-simbolo.svg`]} alt="" className="about-logo" />
      </div>
      <div className="txt">
        <h2>Goat Filter</h2>
        <p>
          Versão {s.version || "—"}
          {u?.latest && !u.available && " · atualizado"}
        </p>
      </div>
      <div className="ctl about-ctl">
        {u?.available ? (
          <div className="update-box">
            <strong>Nova versão {u.latest} disponível</strong>
            {u.notes && <p className="note">{u.notes}</p>}
            <button type="button" className="btn primary small" onClick={() => getNative().then((n) => n.openRelease(u.url))}>
              Baixar nova versão
            </button>
          </div>
        ) : (
          <button type="button" className="btn small" disabled={s.updateState === "checking"} onClick={s.checkUpdate}>
            {s.updateState === "checking" ? "Verificando…" : "Verificar atualizações"}
          </button>
        )}
        <div className="about-links">
          <button type="button" className="btn link" onClick={() => getNative().then((n) => n.openLogs())}>
            Abrir pasta de logs
          </button>
          <button type="button" className="btn link" onClick={() => getNative().then((n) => n.openRelease(null))}>
            Página de downloads
          </button>
        </div>
      </div>
    </section>
  );
}

function DemoTag() {
  return <span className="pill">demonstração</span>;
}
