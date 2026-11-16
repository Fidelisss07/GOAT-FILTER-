import { useEffect, useState } from "react";
import { Toggle, ToggleRow } from "../components/Controls";
import { BoltIcon, CheckIcon, CheckSquareIcon, KeyboardIcon } from "../components/Icons";
import { KeyCapture } from "../components/KeyCapture";
import { getNative } from "../lib/native";
import { Bindings, DEFAULT_BINDINGS, PerfStatus, PerfTweaks } from "../lib/types";
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
  if (good == null) return null;
  return <span className={`pill ${good ? "accent" : ""}`}>agora: {children}</span>;
}

const RECOMMENDATIONS: { title: string; detail: React.ReactNode }[] = [
  {
    title: "NVIDIA Reflex no Valorant",
    detail: <>Valorant › Configurações › Vídeo › Gráficos: <em>Ligado + Aumento</em>. É o ajuste que mais reduz o atraso do clique até a tela.</>,
  },
  {
    title: "Buffer de entrada bruta",
    detail: <>Valorant › Configurações › Geral › Mouse: <em>Ligado</em>. Lê o mouse direto, sem passar pelo Windows.</>,
  },
  {
    title: "Taxa de polling do mouse",
    detail: <>No programa do fabricante do mouse, use <em>1000 Hz</em> ou mais.</>,
  },
  {
    title: "FPS acima da taxa do monitor",
    detail: <>Com monitor de 144 Hz, mantenha o FPS acima de 144 e desligue o V-Sync no jogo.</>,
  },
];

export function PerformancePage() {
  const s = useStore();
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
    return other ? `Mesma tecla de "${other.label}".` : null;
  };

  return (
    <div className="perf-grid">
      <div className="stack">
        <section className="panel" aria-label="Checklist de latência">
          <div className="section-head">
            <CheckSquareIcon />
            <h2>Checklist de latência</h2>
          </div>
          <div className="rows checklist">
            <div className="row">
              <span>Modo de Jogo do Windows</span>
              {st?.gameMode == null ? (
                <span className="state muted">Só no Windows</span>
              ) : st.gameMode ? (
                <span className="state on"><CheckIcon /> Ligado</span>
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
                  Ligar
                </button>
              )}
            </div>
            {RECOMMENDATIONS.map((r) => (
              <details key={r.title} className="row-details">
                <summary className="row">
                  <span>{r.title}</span>
                  <span className="state muted" title="Recomendação: confira no jogo ou no programa do mouse">Verificar</span>
                </summary>
                <p className="note">{r.detail}</p>
              </details>
            ))}
          </div>
          <p className="note">
            “Verificar” são recomendações: o Goat Filter não altera o jogo nem o mouse. Nenhum programa “zera” os
            milissegundos; isto é o que reduz o atraso de verdade.
          </p>
        </section>

        <section className="panel" aria-label="Enquanto joga">
          <div className="section-head">
            <BoltIcon />
            <h2>Enquanto joga</h2>
            {st?.applied && <span className="pill accent">ativos agora</span>}
          </div>
          <p className="meta">Ligados quando o jogo abre e desfeitos quando ele fecha (ou no alt-tab, com “Só com o jogo em foco”).</p>
          <div className="rows">
            <ToggleRow
              label="Desligar aceleração do mouse"
              checked={perf.mouseAccelOff}
              onChange={(v) => setPerf({ mouseAccelOff: v })}
              extra={<Now good={st?.mouseAccel == null ? null : !st.mouseAccel}>{st?.mouseAccel ? "ligada" : "desligada"}</Now>}
            />
            <ToggleRow label="Teclado: repetição mais rápida" checked={perf.keyboardFast} onChange={(v) => setPerf({ keyboardFast: v })} />
            <ToggleRow
              label="Plano de energia Alto desempenho"
              checked={perf.highPerformancePower}
              onChange={(v) => setPerf({ highPerformancePower: v })}
              extra={<Now good={st?.powerHigh ?? null}>{st?.powerHigh ? "alto desempenho" : "outro plano"}</Now>}
            />
          </div>
        </section>
      </div>

      <section className="panel shortcuts" aria-label="Atalhos">
        <div className="section-head">
          <KeyboardIcon />
          <h2>Atalhos</h2>
          <Toggle label="Atalhos ligados" checked={s.settings.hotkeys} onChange={(v) => s.updateSettings({ hotkeys: v })} />
        </div>
        <div className="rows">
          {BIND_ROWS.map((r) => (
            <KeyCapture
              key={r.key}
              label={r.label}
              value={b[r.key]}
              disabled={!s.settings.hotkeys}
              conflict={dup(r.key)}
              onChange={(v) => s.updateSettings({ bindings: { ...b, [r.key]: v } })}
            />
          ))}
        </div>
        <button type="button" className="btn block" onClick={() => s.updateSettings({ bindings: { ...DEFAULT_BINDINGS } })}>
          Voltar às teclas padrão
        </button>
        <p className="note">Clique numa tecla e aperte a nova combinação, com Ctrl ou Alt. Os atalhos não mudam as teclas do jogo nem simulam teclas.</p>
      </section>
    </div>
  );
}
