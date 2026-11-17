import { useEffect, useRef, useState } from "react";
import { best, loadResults, saveResult } from "../lib/trainStats";
import { useT } from "../lib/useT";

/** Tempo de reação: clique quando a área ficar verde. Média de 5. */
export function ReactionTest() {
  const t = useT();
  type Phase = "idle" | "wait" | "go" | "early" | "done";
  const [phase, setPhase] = useState<Phase>("idle");
  const [times, setTimes] = useState<number[]>([]);
  const [record, setRecord] = useState<number | null>(() => best(loadResults(), "reaction"));
  const goAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    setPhase("wait");
    timer.current = setTimeout(() => {
      goAt.current = performance.now();
      setPhase("go");
    }, 1200 + Math.random() * 2600);
  };

  const click = () => {
    if (phase === "idle" || phase === "done" || phase === "early") {
      if (phase === "done") setTimes([]);
      arm();
      return;
    }
    if (phase === "wait") {
      clearTimeout(timer.current);
      setPhase("early");
      return;
    }
    const ms = Math.round(performance.now() - goAt.current);
    const next = [...times, ms];
    setTimes(next);
    if (next.length >= 5) {
      const avg = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
      setRecord(best(saveResult({ mode: "reaction", score: avg, at: Date.now() }), "reaction"));
      setPhase("done");
    } else {
      arm();
    }
  };

  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const label: Record<Phase, string> = {
    idle: t("Clique para começar"),
    wait: t("Espere o verde…"),
    go: t("Clique!"),
    early: t("Cedo demais! Clique para tentar de novo"),
    done: t("Média: {ms} ms · clique para repetir", { ms: avg ?? 0 }),
  };

  return (
    <div className="quick">
      <button type="button" className={`reaction ${phase}`} onMouseDown={click}>
        <strong>{label[phase]}</strong>
        {times.length > 0 && phase !== "done" && <span>{times.map((x) => `${x} ms`).join(" · ")}</span>}
      </button>
      <p className="note">
        {t("5 tentativas.")} {record != null && t("Recorde: {ms} ms", { ms: record })}
      </p>
    </div>
  );
}

/** Taxa de polling real do mouse: conta eventos brutos por segundo. */
export function PollingTest() {
  const t = useT();
  const stamps = useRef<number[]>([]);
  const [rate, setRate] = useState(0);
  const [peak, setPeak] = useState(0);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const hasRaw = "onpointerrawupdate" in el;
    const onEvent = (e: Event) => {
      const now = performance.now();
      // Sem pointerrawupdate, conta os eventos agrupados do pointermove.
      const n = !hasRaw && "getCoalescedEvents" in e ? (e as PointerEvent).getCoalescedEvents().length || 1 : 1;
      for (let i = 0; i < n; i++) stamps.current.push(now);
      while (stamps.current.length && now - stamps.current[0] > 1000) stamps.current.shift();
    };
    const type = hasRaw ? "pointerrawupdate" : "pointermove";
    el.addEventListener(type, onEvent);
    const id = setInterval(() => {
      const now = performance.now();
      while (stamps.current.length && now - stamps.current[0] > 1000) stamps.current.shift();
      const r = stamps.current.length;
      setRate(r);
      setPeak((p) => Math.max(p, r));
    }, 250);
    return () => {
      el.removeEventListener(type, onEvent);
      clearInterval(id);
    };
  }, []);

  const verdict = peak === 0 ? null : peak >= 900 ? "1000 Hz+" : peak >= 450 ? "500 Hz" : peak >= 220 ? "250 Hz" : "125 Hz";

  return (
    <div className="quick">
      <div ref={area} className="poll-area">
        <strong>{rate} Hz</strong>
        <span>{t("Mova o mouse rápido em círculos aqui dentro")}</span>
      </div>
      <p className="note">
        {t("Pico: {hz} Hz", { hz: peak })}
        {verdict && ` · ${t("seu mouse parece estar em {v}", { v: verdict })}`}
        {peak > 0 && peak < 450 && ` · ${t("suba para 1000 Hz no programa do mouse")}`}
      </p>
    </div>
  );
}

/** Teste de clique duplo: cliques do mesmo botão com menos de 80 ms. */
export function DoubleClickTest() {
  const t = useT();
  const last = useRef<Record<number, number>>({});
  const [counts, setCounts] = useState({ clicks: [0, 0, 0], doubles: [0, 0, 0] });
  const names = [t("Esquerdo"), t("Meio"), t("Direito")];

  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    const b = e.button;
    if (b > 2) return;
    const now = performance.now();
    const prev = last.current[b];
    last.current[b] = now;
    setCounts((c) => {
      const clicks = [...c.clicks];
      const doubles = [...c.doubles];
      clicks[b]++;
      if (prev != null && now - prev < 80) doubles[b]++;
      return { clicks, doubles };
    });
  };

  return (
    <div className="quick">
      <div className="click-area" onMouseDown={down} onContextMenu={(e) => e.preventDefault()}>
        {t("Clique aqui várias vezes, devagar, com cada botão")}
      </div>
      <div className="click-stats">
        {names.map((n, i) => (
          <div key={n} className={counts.doubles[i] > 0 ? "bad" : ""}>
            <strong>{n}</strong>
            <span>{t("{c} cliques · {d} duplos", { c: counts.clicks[i], d: counts.doubles[i] })}</span>
          </div>
        ))}
      </div>
      <p className="note">
        {counts.doubles.some((d) => d > 0)
          ? t("Cliques duplos sem querer: o botão pode estar com defeito.")
          : t("Clicando devagar, nenhum clique deve virar duplo.")}
      </p>
    </div>
  );
}
