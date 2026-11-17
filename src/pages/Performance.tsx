import { useEffect, useState } from "react";
import { Toggle, ToggleRow } from "../components/Controls";
import { BoltIcon, CheckIcon, CheckSquareIcon, KeyboardIcon } from "../components/Icons";
import { CloseApps } from "../components/CloseApps";
import { KeyCapture } from "../components/KeyCapture";
import { MachinePanel } from "../components/MachinePanel";
import { SystemChecks } from "../components/SystemChecks";
import { getNative } from "../lib/native";
import { Bindings, DEFAULT_BINDINGS, PerfStatus, PerfTweaks } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

const BIND_ROWS: { key: keyof Bindings; label: string }[] = [
  { key: "toggle", label: "Ligar / desligar o filtro" },
  { key: "vibranceUp", label: "Subir vibrância" },
  { key: "vibranceDown", label: "Descer vibrância" },
  { key: "nextProfile", label: "Próximo perfil" },
];

function usePerfStatus() {
  const [st, setSt] = useState<PerfStatus | null>(null);
  const refresh = () =>
    getNative()
      .then((n) => n.perfStatus())
      .then(setSt)
      .catch(() => setSt(null));
  useEffect(() => {
    void refresh();
  }, []);
  return { st, setSt, refresh };
}

function Now({ children, good }: { children: string; good: boolean | null }) {
  const t = useT();
  if (good == null) return null;
  return <span className={`pill ${good ? "accent" : ""}`}>{t("agora: {v}", { v: t(children) })}</span>;
}

const RECOMMENDATIONS: { title: string; detail: string }[] = [
  {
    title: "NVIDIA Reflex no Valorant",
    detail: "Valorant › Configurações › Vídeo › Gráficos: Ligado + Aumento. É o ajuste que mais reduz o atraso do clique até a tela.",
  },
  {
    title: "Buffer de entrada bruta",
    detail: "Valorant › Configurações › Geral › Mouse: Ligado. Lê o mouse direto, sem passar pelo Windows.",
  },
  {
    title: "Taxa de polling do mouse",
    detail: "No programa do fabricante do mouse, use 1000 Hz ou mais.",
  },
  {
    title: "FPS acima da taxa do monitor",
    detail: "Com monitor de 144 Hz, mantenha o FPS acima de 144 e desligue o V-Sync no jogo.",
  },
];

export function PerformancePage() {
  const s = useStore();
  const t = useT();
  const perf = s.settings.perf;
  const b = s.settings.bindings;
  const { st, setSt, refresh } = usePerfStatus();
  const setPerf = async (patch: Partial<PerfTweaks>) => {
    await s.updateSettings({ perf: { ...perf, ...patch } });
    void refresh();
  };

  const dup = (key: keyof Bindings) => {
    const v = b[key];
    const other = BIND_ROWS.find((r) => r.key !== key && b[r.key] === v);
    return other ? t("Mesma tecla de \"{name}\".", { name: t(other.label) }) : null;
  };

  return (
    <div className="perf-grid">
      <div className="stack">
        <section className="panel" aria-label={t("Checklist de latência")}>
          <div className="section-head">
            <CheckSquareIcon />
            <h2>{t("Checklist de latência")}</h2>
          </div>
          <div className="rows checklist">
            <SystemChecks />
            <div className="row">
              <span>{t("Modo de Jogo do Windows")}</span>
              {st?.gameMode == null ? (
                <span className="state muted">{t("Só no Windows")}</span>
              ) : st.gameMode ? (
                <span className="state on"><CheckIcon /> {t("Ligado")}</span>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    getNative()
                      .then((n) => n.setGameMode(true))
                      .then(setSt)
                      .catch((e) => s.showToast({ kind: "error", text: String(e) }))
                  }
                >
                  {t("Ligar")}
                </button>
              )}
            </div>
            {RECOMMENDATIONS.map((r) => (
              <details key={r.title} className="row-details">
                <summary className="row">
                  <span>{t(r.title)}</span>
                  <span className="state muted" title={t("Recomendação: confira no jogo ou no programa do mouse")}>{t("Verificar")}</span>
                </summary>
                <p className="note">{t(r.detail)}</p>
              </details>
            ))}
          </div>
          <p className="note">
            {t("“Verificar” são recomendações: o Goat Filter não altera o jogo nem o mouse. Nenhum programa “zera” os milissegundos; isto é o que reduz o atraso de verdade.")}
          </p>
        </section>

        <section className="panel" aria-label={t("Enquanto joga")}>
          <div className="section-head">
            <BoltIcon />
            <h2>{t("Enquanto joga")}</h2>
            {st?.applied && <span className="pill accent">{t("ativos agora")}</span>}
          </div>
          <p className="meta">{t("Ligados quando o jogo abre e desfeitos quando ele fecha (ou no alt-tab, com “Só com o jogo em foco”).")}</p>
          <div className="rows">
            <ToggleRow
              label={t("Desligar aceleração do mouse")}
              checked={perf.mouseAccelOff}
              onChange={(v) => setPerf({ mouseAccelOff: v })}
              extra={<Now good={st?.mouseAccel == null ? null : !st.mouseAccel}>{st?.mouseAccel ? "ligada" : "desligada"}</Now>}
            />
            <ToggleRow label={t("Teclado: repetição mais rápida")} checked={perf.keyboardFast} onChange={(v) => setPerf({ keyboardFast: v })} />
            <ToggleRow
              label={t("Plano de energia Alto desempenho")}
              checked={perf.highPerformancePower}
              onChange={(v) => setPerf({ highPerformancePower: v })}
              extra={<Now good={st?.powerHigh ?? null}>{st?.powerHigh ? "alto desempenho" : "outro plano"}</Now>}
            />
          </div>
          <div className="section">
            <div className="section-head">
              <h3>{t("Fechar ao abrir o jogo")}</h3>
            </div>
            <CloseApps />
          </div>
        </section>
      </div>

      <div className="stack">
      <section className="panel shortcuts" aria-label={t("Atalhos")}>
        <div className="section-head">
          <KeyboardIcon />
          <h2>{t("Atalhos")}</h2>
          <Toggle label={t("Atalhos ligados")} checked={s.settings.hotkeys} onChange={(v) => s.updateSettings({ hotkeys: v })} />
        </div>
        <div className="rows">
          {BIND_ROWS.map((r) => (
            <KeyCapture
              key={r.key}
              label={t(r.label)}
              value={b[r.key]}
              disabled={!s.settings.hotkeys}
              conflict={dup(r.key)}
              onChange={(v) => s.updateSettings({ bindings: { ...b, [r.key]: v } })}
            />
          ))}
        </div>
        <button type="button" className="btn block" onClick={() => s.updateSettings({ bindings: { ...DEFAULT_BINDINGS } })}>
          {t("Voltar às teclas padrão")}
        </button>
        <p className="note">{t("Clique numa tecla e aperte a nova combinação, com Ctrl ou Alt. Os atalhos não mudam as teclas do jogo nem simulam teclas.")}</p>
      </section>
      <MachinePanel />
      </div>
    </div>
  );
}
