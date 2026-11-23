import { useId, useState } from "react";
import { CrosshairIcon } from "../components/Icons";
import { PollingTest } from "../components/QuickTests";
import { SensConverter } from "../components/SensConverter";
import { FinderResult, SensFinder } from "../components/SensFinder";
import { DpiCalc } from "../components/TrainingExtras";
import { cmPer360, convertSens, eDpi, round, SENS_GAMES } from "../lib/sens";
import { band, loadProfile, PRO_EDPI, saveProfile, SensProfile } from "../lib/sensFinder";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

const BAND_LABEL = {
  "muito baixa": "Muito baixa",
  baixa: "Baixa",
  média: "Média (como a maioria dos pros)",
  alta: "Alta",
  "muito alta": "Muito alta",
} as const;

function num(v: string) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Onde o eDPI cai numa régua de 0 a 800, com a faixa dos profissionais. */
function EdpiScale({ edpi }: { edpi: number }) {
  const t = useT();
  const max = 800;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="edpi-scale" role="img" aria-label={t("Seu eDPI comparado ao dos profissionais")}>
      <div className="edpi-track">
        <div className="edpi-pro" style={{ left: pct(PRO_EDPI.low), width: `calc(${pct(PRO_EDPI.high)} - ${pct(PRO_EDPI.low)})` }} />
        <div className="edpi-avg" style={{ left: pct(PRO_EDPI.avg) }} />
        {edpi > 0 && <div className="edpi-you" style={{ left: pct(edpi) }} />}
      </div>
      <div className="edpi-legend">
        <span>0</span>
        <span>{t("faixa dos pros ({a} a {b})", { a: PRO_EDPI.low, b: PRO_EDPI.high })}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function MySens({ profile, setProfile }: { profile: SensProfile; setProfile(p: SensProfile): void }) {
  const t = useT();
  const dpiId = useId();
  const sensId = useId();
  const scopedId = useId();
  const [dpi, setDpi] = useState(String(profile.dpi));
  const [sens, setSens] = useState(String(profile.sens));
  const [scoped, setScoped] = useState(String(profile.scoped));
  const d = num(dpi), s = num(sens), sc = num(scoped);
  const ok = d > 0 && s > 0;
  const e = ok ? eDpi(s, d) : 0;
  const changed = d !== profile.dpi || s !== profile.sens || sc !== profile.scoped;
  const save = () => {
    if (!ok) return;
    const p = {
      ...profile,
      dpi: d,
      sens: s,
      scoped: sc > 0 ? sc : 1,
      history: profile.sens !== s || profile.dpi !== d ? [{ at: Date.now(), sens: s, dpi: d, source: "manual" as const }, ...profile.history] : profile.history,
    };
    setProfile(p);
  };
  return (
    <section className="panel" aria-label={t("Minha sensibilidade")}>
      <div className="section-head">
        <CrosshairIcon />
        <h2>{t("Minha sensibilidade")}</h2>
      </div>
      <div className="conv-grid sens-inputs">
        <div className="conv-field">
          <label htmlFor={dpiId}>DPI</label>
          <input id={dpiId} className="input" inputMode="numeric" value={dpi} onChange={(x) => setDpi(x.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="conv-field">
          <label htmlFor={sensId}>{t("Sensibilidade no Valorant")}</label>
          <input id={sensId} className="input" inputMode="decimal" value={sens} onChange={(x) => setSens(x.target.value)} />
        </div>
        <div className="conv-field">
          <label htmlFor={scopedId}>{t("Multiplicador da luneta")}</label>
          <input id={scopedId} className="input" inputMode="decimal" value={scoped} onChange={(x) => setScoped(x.target.value)} />
        </div>
      </div>
      <div className="conv-result" aria-live="polite">
        <div>
          <span>eDPI</span>
          <strong>{ok ? round(e, 0) : "—"}</strong>
        </div>
        <div>
          <span>{t("cm por volta (360°)")}</span>
          <strong>{ok ? round(cmPer360(s, d, "valorant"), 1) : "—"}</strong>
        </div>
        <div>
          <span>{t("Faixa")}</span>
          <strong className="band">{ok ? t(BAND_LABEL[band(e)]) : "—"}</strong>
        </div>
      </div>
      <EdpiScale edpi={e} />
      <div className="save-row">
        <button type="button" className="btn primary" disabled={!ok || !changed} onClick={save}>{t("Salvar")}</button>
      </div>
    </section>
  );
}

function FinderPanel({ profile, setProfile }: { profile: SensProfile; setProfile(p: SensProfile): void }) {
  const t = useT();
  const s = useStore();
  const [last, setLast] = useState<FinderResult | null>(null);
  const [key, setKey] = useState(0);
  const apply = () => {
    if (!last) return;
    setProfile({ ...profile, sens: last.sens, history: [{ at: Date.now(), sens: last.sens, dpi: profile.dpi, source: "finder" }, ...profile.history] });
    s.showToast({ kind: "ok", text: t("Pronto. Coloque {v} na sensibilidade do Valorant.", { v: last.sens.toFixed(3) }) });
  };
  const diff = last ? Math.round(((last.sens - profile.sens) / profile.sens) * 100) : 0;
  return (
    <section className="panel finder-panel" aria-label={t("Descobrir minha sensibilidade")}>
      <div className="section-head">
        <CrosshairIcon />
        <h2>{t("Descobrir minha sensibilidade")}</h2>
      </div>
      <p className="meta">
        {t("Comece pela sensibilidade que você usa hoje ({v} com {dpi} DPI). O teste usa o mesmo cálculo e o mesmo campo de visão do Valorant, e lê o mouse sem a aceleração do Windows.", {
          v: profile.sens,
          dpi: profile.dpi,
        })}
      </p>
      <SensFinder key={key} start={profile.sens} dpi={profile.dpi} onDone={setLast} />
      {last && (
        <div className="finder-result">
          <p>
            {diff === 0
              ? t("Igual à que você já usa. Pode confiar nela.")
              : diff < 0
                ? t("{n}% mais baixa que a sua atual.", { n: -diff })
                : t("{n}% mais alta que a sua atual.", { n: diff })}
          </p>
          <div className="conv-result">
            {SENS_GAMES.filter((g) => g.id !== "valorant").map((g) => (
              <div key={g.id}>
                <span>{g.name}</span>
                <strong>{round(convertSens(last.sens, "valorant", g.id), 3)}</strong>
              </div>
            ))}
          </div>
          <div className="save-row">
            <button type="button" className="btn" onClick={() => setKey((k) => k + 1)}>{t("Fazer de novo")}</button>
            <button type="button" className="btn primary" onClick={apply}>{t("Usar esta sensibilidade")}</button>
          </div>
          {Math.abs(diff) >= 25 && (
            <p className="note">{t("Ficou bem longe da sua atual. Use esta e faça o teste de novo: começando mais perto, ele afina o resultado.")}</p>
          )}
          <p className="note">{t("Jogue alguns dias com ela antes de julgar. Mudar de sensibilidade toda hora atrapalha mais do que ajuda.")}</p>
        </div>
      )}
    </section>
  );
}

function DpiSwap({ profile }: { profile: SensProfile }) {
  const t = useT();
  const id = useId();
  const [next, setNext] = useState("1600");
  const n = num(next);
  const out = n > 0 ? (profile.sens * profile.dpi) / n : 0;
  return (
    <section className="panel" aria-label={t("Trocar de DPI sem mudar a mira")}>
      <div className="section-head">
        <CrosshairIcon />
        <h2>{t("Trocar de DPI sem mudar a mira")}</h2>
      </div>
      <div className="conv-grid sens-inputs">
        <div className="conv-field">
          <label htmlFor={id}>{t("DPI novo")}</label>
          <input id={id} className="input" inputMode="numeric" value={next} onChange={(x) => setNext(x.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      <div className="conv-result">
        <div>
          <span>{t("Sensibilidade com o DPI novo")}</span>
          <strong>{n > 0 ? round(out, 3) : "—"}</strong>
        </div>
        <div>
          <span>eDPI</span>
          <strong>{round(eDpi(profile.sens, profile.dpi), 0)}</strong>
        </div>
      </div>
      <p className="note">{t("O eDPI e os cm por volta continuam iguais: a mira fica do mesmo jeito, só mais precisa com DPI maior.")}</p>
    </section>
  );
}

function History({ profile }: { profile: SensProfile }) {
  const t = useT();
  if (profile.history.length === 0) return null;
  return (
    <section className="panel" aria-label={t("Histórico")}>
      <div className="section-head">
        <CrosshairIcon />
        <h2>{t("Histórico")}</h2>
      </div>
      <ul className="sens-history">
        {profile.history.slice(0, 8).map((h) => (
          <li key={h.at}>
            <span>{new Date(h.at).toLocaleDateString()}</span>
            <strong>{h.sens.toFixed(3)}</strong>
            <span>{h.dpi} DPI · eDPI {round(h.sens * h.dpi, 0)}</span>
            <em>{h.source === "finder" ? t("teste") : t("manual")}</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TIPS = [
  "O Valorant lê o mouse direto (entrada bruta): a velocidade do ponteiro e a aceleração do Windows não mudam a mira no jogo.",
  "Use 800 ou 1600 DPI e ajuste no jogo. DPI muito alto com sensibilidade muito baixa não traz vantagem.",
  "Deixe o multiplicador da luneta em 1: assim a Operator e a Marshal giram na mesma medida que o rifle.",
  "Mouse a 1000 Hz ou mais deixa o movimento mais suave. Teste na seção Taxa de polling.",
  "Uma mesa grande e mousepad de tecido ajudam com sensibilidades baixas.",
];

export function SensitivityPage() {
  const t = useT();
  const [profile, setP] = useState(loadProfile);
  const setProfile = (p: SensProfile) => {
    setP(p);
    saveProfile(p);
  };
  return (
    <div className="sens-page">
      <MySens key={`${profile.dpi}-${profile.sens}-${profile.scoped}`} profile={profile} setProfile={setProfile} />
      <FinderPanel profile={profile} setProfile={setProfile} />
      <div className="sens-grid">
        <DpiSwap profile={profile} />
        <section className="panel" aria-label={t("Conversor entre jogos")}>
          <div className="section-head">
            <CrosshairIcon />
            <h2>{t("Conversor entre jogos")}</h2>
          </div>
          <SensConverter />
        </section>
        <section className="panel" aria-label={t("Medir meu DPI de verdade")}>
          <div className="section-head">
            <CrosshairIcon />
            <h2>{t("Medir meu DPI de verdade")}</h2>
          </div>
          <p className="meta">{t("O DPI anunciado pelo fabricante às vezes varia. Meça com uma régua.")}</p>
          <DpiCalc />
        </section>
        <section className="panel" aria-label={t("Taxa de polling")}>
          <div className="section-head">
            <CrosshairIcon />
            <h2>{t("Taxa de polling")}</h2>
          </div>
          <PollingTest />
        </section>
      </div>
      <History profile={profile} />
      <section className="panel" aria-label={t("Dicas")}>
        <div className="section-head">
          <CrosshairIcon />
          <h2>{t("Dicas")}</h2>
        </div>
        <ul className="sens-tips">
          {TIPS.map((x) => (
            <li key={x}>{t(x)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
