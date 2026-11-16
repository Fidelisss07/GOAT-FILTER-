import { MonitorSelect, ToggleRow } from "../components/Controls";
import { MonitorIcon, PowerIcon, SparkIcon } from "../components/Icons";
import { getNative } from "../lib/native";
import { METHOD_LABEL, THEMES, ThemeId } from "../lib/types";
import { useStore } from "../state/store";

// Ordem do mockup: Rosa, Roxo, Amarelo.
const ORDER: ThemeId[] = ["rosa", "roxo", "amarelo"];

export function SettingsPage() {
  const s = useStore();
  const st = s.settings;
  const demo = s.capabilities.demo;
  const defaultMonitor =
    s.monitors.find((m) => m.id === st.defaultMonitor)?.id ?? s.monitors.find((m) => m.primary)?.id ?? null;

  return (
    <div className="stack">
      <section className="panel" aria-label="Preferências">
        <div className="section" aria-label="Aparência">
          <div className="section-head">
            <MonitorIcon />
            <h2>Aparência</h2>
          </div>
          <div className="row">
            <span>Cor de destaque do aplicativo</span>
            <div className="radios" role="radiogroup" aria-label="Tema do aplicativo">
              {ORDER.map((id) => {
                const t = THEMES.find((x) => x.id === id)!;
                const on = st.theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="radio-opt"
                    onClick={() => s.setTheme(id)}
                  >
                    <span className="radio-dot" aria-hidden />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="section" aria-label="Inicialização">
          <div className="section-head">
            <PowerIcon />
            <h2>Inicialização</h2>
          </div>
          <div className="rows">
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
        </div>

        <div className="section" aria-label="Monitor e ajustes">
          <div className="section-head">
            <MonitorIcon />
            <h2>Monitor e ajustes</h2>
          </div>
          <div className="rows">
            <div className="row">
              <span>Monitor padrão</span>
              <div className="row-ctl">
                <MonitorSelect
                  label="Monitor padrão"
                  showLabel={false}
                  monitors={s.monitors}
                  value={defaultMonitor}
                  onChange={(id) => s.updateSettings({ defaultMonitor: id })}
                />
              </div>
            </div>
            <ToggleRow
              label="Restaurar cores ao sair"
              checked={st.restoreOnExit}
              onChange={(v) => s.updateSettings({ restoreOnExit: v })}
              extra={demo ? <DemoTag /> : null}
            />
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Super Vibrance">
        <div className="section">
          <div className="section-head">
            <SparkIcon />
            <h2>Super Vibrance</h2>
          </div>
          <p className="meta">Como aplicar a faixa acima de 100%.</p>
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
                  <span className="radio-dot" aria-hidden />
                  <span className="body">
                    <strong>{info.title}</strong>
                    <span>{m.available ? info.detail : `Indisponível: ${m.reason ?? "não suportado"}`}</span>
                  </span>
                </button>
              );
            })}
          </div>
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
    <section className="panel about" aria-label="Sobre">
      <div className="section-head">
        <img src={logos[`../assets/logo/${s.settings.theme}-simbolo.svg`]} alt="" className="about-logo" />
        <h2>Goat Filter</h2>
        <span className="meta">
          Versão {s.version || "—"}
          {u?.latest && !u.available && " · atualizado"}
        </span>
      </div>
      <div className="ctl about-ctl">
        {s.updater.pending ? (
          <div className="update-box">
            <strong>Versão {s.updater.pending} pronta para instalar</strong>
            <p className="note">Instala sozinha na próxima vez que o Goat Filter abrir.</p>
            <button type="button" className="btn primary small" onClick={() => getNative().then((n) => n.installUpdateNow())}>
              Reiniciar e atualizar agora
            </button>
          </div>
        ) : u?.available ? (
          <div className="update-box">
            <strong>Nova versão {u.latest} disponível</strong>
            {u.notes && <p className="note">{u.notes}</p>}
            {s.settings.autoUpdate && s.updater.installed && <p className="note">Baixando em segundo plano…</p>}
            <button type="button" className="btn small" onClick={() => getNative().then((n) => n.openRelease(u.url))}>
              Abrir página da versão
            </button>
          </div>
        ) : (
          <button type="button" className="btn small" disabled={s.updateState === "checking"} onClick={s.checkUpdate}>
            {s.updateState === "checking" ? "Verificando…" : "Verificar atualizações"}
          </button>
        )}
        <ToggleRow
          label="Atualizar sozinho"
          checked={s.settings.autoUpdate}
          disabled={!s.updater.installed}
          onChange={(v) => s.updateSettings({ autoUpdate: v })}
          extra={!s.updater.installed ? <span className="pill">só na versão instalada</span> : null}
        />
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
