import { useEffect, useState } from "react";
import { ToggleRow } from "../components/Controls";
import { BoltIcon, CheckIcon, KeyboardIcon, ListIcon } from "../components/Icons";
import { KeyCapture } from "../components/KeyCapture";
import { getNative } from "../lib/native";
import { Bindings, DEFAULT_BINDINGS, PerfStatus, PerfTweaks } from "../lib/types";
import { useStore } from "../state/store";

const BIND_ROWS: { key: keyof Bindings; label: string }[] = [
  { key: "toggle", label: "Ligar / desligar o filtro" },
  { key: "vibranceUp", label: "Subir vibrance (+10%)" },
  { key: "vibranceDown", label: "Descer vibrance (−10%)" },
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
    <div className="settings performance">
      <section className="card set-card" aria-label="Enquanto o jogo estiver aberto">
        <div className="ico"><BoltIcon /></div>
        <div className="txt">
          <h2>Enquanto joga</h2>
          <p>Ajustes do Windows ligados quando o jogo abre e desfeitos quando ele fecha (ou no alt-tab, se o perfil usar “Só com o jogo em foco”).</p>
          {st?.applied && <p className="note"><span className="pill accent">ativos agora</span></p>}
        </div>
        <div className="ctl">
          <ToggleRow
            label="Desligar aceleração do mouse"
            checked={perf.mouseAccelOff}
            onChange={(v) => setPerf({ mouseAccelOff: v })}
            extra={<Now good={st?.mouseAccel == null ? null : !st.mouseAccel}>{st?.mouseAccel ? "ligada" : "desligada"}</Now>}
          />
          <p className="note tight">“Aprimorar precisão do ponteiro” do Windows. O mouse responde igual em qualquer velocidade.</p>
          <ToggleRow
            label="Teclado: repetição mais rápida"
            checked={perf.keyboardFast}
            onChange={(v) => setPerf({ keyboardFast: v })}
          />
          <p className="note tight">Atraso mínimo e velocidade máxima ao segurar uma tecla (menus e chat).</p>
          <ToggleRow
            label="Plano de energia Alto desempenho"
            checked={perf.highPerformancePower}
            onChange={(v) => setPerf({ highPerformancePower: v })}
            extra={<Now good={st?.powerHigh ?? null}>{st?.powerHigh ? "alto desempenho" : "outro plano"}</Now>}
          />
          <p className="note tight">Evita que a CPU reduza a velocidade durante a partida. Reduz quedas de FPS.</p>
        </div>
      </section>

      <section className="card set-card" aria-label="Teclas do Goat Filter">
        <div className="ico"><KeyboardIcon /></div>
        <div className="txt">
          <h2>Teclas</h2>
          <p>Atalhos do Goat Filter que funcionam com o jogo aberto. Clique numa tecla e aperte a nova combinação (com Ctrl ou Alt).</p>
          <p className="note">Elas não mudam as teclas do jogo nem simulam teclas — é isso que mantém o Goat Filter seguro contra ban.</p>
        </div>
        <div className="ctl">
          <ToggleRow label="Atalhos ligados" checked={s.settings.hotkeys} onChange={(v) => s.updateSettings({ hotkeys: v })} />
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
          <button type="button" className="btn link" onClick={() => s.updateSettings({ bindings: { ...DEFAULT_BINDINGS } })}>
            Voltar às teclas padrão
          </button>
        </div>
      </section>

      <section className="card set-card" aria-label="O que mais tira delay">
        <div className="ico"><ListIcon /></div>
        <div className="txt">
          <h2>O que mais tira delay</h2>
          <p>Nenhum programa “zera” os milissegundos do mouse e do teclado. O que reduz o atraso de verdade é isto:</p>
        </div>
        <div className="ctl checklist">
          <div className="check-item">
            <span className={`mark ${st?.gameMode ? "on" : ""}`}>{st?.gameMode && <CheckIcon />}</span>
            <div>
              <strong>Modo de Jogo do Windows</strong>
              <span>{st?.gameMode == null ? "Disponível só no Windows." : st.gameMode ? "Ligado." : "Desligado."}</span>
            </div>
            {st?.gameMode === false && (
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
          <div className="check-item">
            <span className="mark" />
            <div>
              <strong>NVIDIA Reflex no Valorant</strong>
              <span>Configurações › Vídeo › Gráficos: <em>Ligado + Aumento</em>. É o ajuste que mais reduz o atraso do clique até a tela.</span>
            </div>
          </div>
          <div className="check-item">
            <span className="mark" />
            <div>
              <strong>Buffer de entrada bruta</strong>
              <span>Valorant › Configurações › Geral › Mouse: <em>Ligado</em>. Lê o mouse direto, sem passar pelo Windows.</span>
            </div>
          </div>
          <div className="check-item">
            <span className="mark" />
            <div>
              <strong>Taxa de polling do mouse</strong>
              <span>No programa do fabricante do mouse, use <em>1000 Hz</em> ou mais.</span>
            </div>
          </div>
          <div className="check-item">
            <span className="mark" />
            <div>
              <strong>FPS acima da taxa do monitor</strong>
              <span>Com monitor de 144 Hz, tente manter o FPS acima de 144 e desligue o V-Sync no jogo.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
