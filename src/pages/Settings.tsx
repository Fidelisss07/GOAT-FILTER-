import { useId } from "react";
import { MonitorSelect, ToggleRow } from "../components/Controls";
import { ChevronDown, MonitorIcon, PowerIcon, SparkIcon } from "../components/Icons";
import { UpdateActions } from "../components/UpdatePanel";
import { getNative } from "../lib/native";
import { Language, METHOD_LABEL, THEMES, ThemeId } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

// Ordem do mockup: Rosa, Roxo, Amarelo.
const ORDER: ThemeId[] = ["rosa", "roxo", "amarelo"];

const LANGUAGES: { id: Language; label: string }[] = [
  { id: "auto", label: "Automático (idioma do Windows)" },
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
];

export function SettingsPage() {
  const s = useStore();
  const t = useT();
  const langId = useId();
  const st = s.settings;
  const demo = s.capabilities.demo;
  const defaultMonitor =
    s.monitors.find((m) => m.id === st.defaultMonitor)?.id ?? s.monitors.find((m) => m.primary)?.id ?? null;
  const demoTag = demo ? <DemoTag /> : null;

  return (
    <div className="stack">
      <section className="panel" aria-label={t("Preferências")}>
        <div className="section" aria-label={t("Aparência")}>
          <div className="section-head">
            <MonitorIcon />
            <h2>{t("Aparência")}</h2>
          </div>
          <div className="rows">
            <div className="row">
              <span>{t("Cor de destaque do aplicativo")}</span>
              <div className="radios" role="radiogroup" aria-label={t("Tema do aplicativo")}>
                {ORDER.map((id) => {
                  const th = THEMES.find((x) => x.id === id)!;
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
                      {t(th.label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="row">
              <label htmlFor={langId}>{t("Idioma")}</label>
              <div className="row-ctl select">
                <select
                  id={langId}
                  value={st.language}
                  onChange={(e) => s.updateSettings({ language: e.target.value as Language })}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id === "auto" ? t(l.label) : l.label}
                    </option>
                  ))}
                </select>
                <ChevronDown />
              </div>
            </div>
          </div>
        </div>

        <div className="section" aria-label={t("Inicialização")}>
          <div className="section-head">
            <PowerIcon />
            <h2>{t("Inicialização")}</h2>
          </div>
          <div className="rows">
            <ToggleRow
              label={t("Iniciar com o Windows")}
              checked={st.startWithWindows}
              onChange={(v) => s.updateSettings({ startWithWindows: v })}
              extra={demoTag}
            />
            <ToggleRow
              label={t("Minimizar para a bandeja")}
              checked={st.minimizeToTray}
              onChange={(v) => s.updateSettings({ minimizeToTray: v })}
              extra={demoTag}
            />
            <ToggleRow
              label={t("Avisar quando um perfil ligar ou desligar")}
              checked={st.notify}
              onChange={(v) => s.updateSettings({ notify: v })}
              extra={demoTag}
            />
          </div>
        </div>

        <div className="section" aria-label={t("Monitor e ajustes")}>
          <div className="section-head">
            <MonitorIcon />
            <h2>{t("Monitor e ajustes")}</h2>
          </div>
          <div className="rows">
            <div className="row">
              <span>{t("Monitor padrão")}</span>
              <div className="row-ctl">
                <MonitorSelect
                  label={t("Monitor padrão")}
                  showLabel={false}
                  monitors={s.monitors}
                  value={defaultMonitor}
                  onChange={(id) => s.updateSettings({ defaultMonitor: id })}
                />
              </div>
            </div>
            <ToggleRow
              label={t("Aplicar perfis em todos os monitores")}
              checked={st.applyAllMonitors}
              onChange={(v) => s.updateSettings({ applyAllMonitors: v })}
              disabled={s.monitors.length < 2 && !demo}
              extra={s.monitors.length < 2 && !demo ? <span className="pill">{t("só um monitor conectado")}</span> : null}
            />
            <ToggleRow
              label={t("Restaurar cores ao sair")}
              checked={st.restoreOnExit}
              onChange={(v) => s.updateSettings({ restoreOnExit: v })}
              extra={demoTag}
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
          <p className="meta">{t("Como aplicar a faixa acima de 100%.")}</p>
          <div className="methods" role="radiogroup" aria-label={t("Método do Super Vibrance")}>
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
                    <strong>{t(info.title)}</strong>
                    <span>
                      {m.available
                        ? t(info.detail)
                        : t("Indisponível: {why}", { why: m.reason ? t(m.reason) : t("não suportado") })}
                    </span>
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
  const t = useT();
  const u = s.update;
  return (
    <section className="panel about" aria-label={t("Sobre")}>
      <div className="section-head">
        <img src={logos[`../assets/logo/${s.settings.theme}-simbolo.svg`]} alt="" className="about-logo" />
        <h2>Goat Filter</h2>
        <span className="meta">
          {t("Versão {v}", { v: s.version || "—" })}
          {u?.latest && !u.available && ` · ${t("atualizado")}`}
        </span>
      </div>
      <div className="ctl about-ctl">
        {s.updater.pending || u?.available ? (
          <UpdateActions />
        ) : (
          <button type="button" className="btn small" disabled={s.updateState === "checking"} onClick={s.checkUpdate}>
            {s.updateState === "checking" ? t("Verificando…") : t("Verificar atualizações")}
          </button>
        )}
        <ToggleRow
          label={t("Atualizar sozinho")}
          checked={s.settings.autoUpdate}
          disabled={!s.updater.installed}
          onChange={(v) => s.updateSettings({ autoUpdate: v })}
          extra={!s.updater.installed ? <span className="pill">{t("só na versão instalada")}</span> : null}
        />
        <div className="about-links">
          <button type="button" className="btn link" onClick={() => getNative().then((n) => n.openLogs())}>
            {t("Abrir pasta de logs")}
          </button>
          <button type="button" className="btn link" onClick={() => getNative().then((n) => n.openRelease(null))}>
            {t("Página de downloads")}
          </button>
        </div>
      </div>
    </section>
  );
}

function DemoTag() {
  const t = useT();
  return <span className="pill">{t("demonstração")}</span>;
}
