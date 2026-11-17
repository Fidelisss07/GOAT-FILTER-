import { useEffect, useState } from "react";
import { getNative } from "../lib/native";
import { SystemStats } from "../lib/types";
import { useT } from "../lib/useT";
import { MonitorIcon } from "./Icons";

function Meter({ label, value, max, unit, warnAt }: { label: string; value: number | null; max: number; unit: string; warnAt?: number }) {
  const pct = value == null ? 0 : Math.min(100, (value / max) * 100);
  const warn = value != null && warnAt != null && value >= warnAt;
  return (
    <div className={`meter ${warn ? "warn" : ""}`}>
      <div className="meter-head">
        <span>{label}</span>
        <strong>{value == null ? "—" : `${Math.round(value * 10) / 10}${unit}`}</strong>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** CPU, RAM e (NVIDIA) GPU, atualizados a cada 2 s enquanto a aba está aberta. */
export function MachinePanel() {
  const t = useT();
  const [st, setSt] = useState<SystemStats | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => getNative().then((n) => n.systemStats()).then((s) => live && setSt(s)).catch(() => {});
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="panel machine" aria-label={t("Painel da máquina")}>
      <div className="section-head">
        <MonitorIcon />
        <h2>{t("Painel da máquina")}</h2>
      </div>
      <Meter label="CPU" value={st?.cpuUsage ?? null} max={100} unit="%" warnAt={90} />
      <Meter label="RAM" value={st?.ramUsedGb ?? null} max={st?.ramTotalGb ?? 16} unit=" GB" warnAt={(st?.ramTotalGb ?? 16) * 0.9} />
      {st?.gpuName ? (
        <>
          <p className="meta gpu-name">{st.gpuName}</p>
          <Meter label={t("Uso da GPU")} value={st.gpuUsage} max={100} unit="%" />
          <Meter label={t("Temperatura da GPU")} value={st.gpuTemp} max={95} unit=" °C" warnAt={83} />
          <Meter label="VRAM" value={st.vramUsedGb} max={st.vramTotalGb ?? 8} unit=" GB" />
        </>
      ) : (
        <p className="note">{t("Uso e temperatura da GPU aparecem com placas NVIDIA.")}</p>
      )}
      <p className="note">{t("Fora do jogo: abra durante uma partida (alt-tab) para ver se a GPU ou a CPU estão no limite.")}</p>
    </section>
  );
}
