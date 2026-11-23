import { useState } from "react";
import { AimTrainer } from "../components/AimTrainer";
import { CrosshairLibrary } from "../components/CrosshairLibrary";
import { TargetIcon } from "../components/Icons";
import { DoubleClickTest, PollingTest, ReactionTest } from "../components/QuickTests";
import { DpiCalc, Progress, VisibilityTest } from "../components/TrainingExtras";
import { getNative } from "../lib/native";
import { VALORANT_ID } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

type Tab = "warmup" | "aim" | "progress" | "reaction" | "mouse" | "sens" | "crosshair" | "visibility";

const TABS: { id: Tab; label: string }[] = [
  { id: "warmup", label: "Aquecer e jogar" },
  { id: "aim", label: "Mira" },
  { id: "progress", label: "Evolução" },
  { id: "reaction", label: "Reação" },
  { id: "mouse", label: "Mouse" },
  { id: "sens", label: "Sensibilidade" },
  { id: "crosshair", label: "Miras" },
  { id: "visibility", label: "Visibilidade" },
];

/** Aquecimento: treino de flick pelo tempo escolhido e, no fim, abre o jogo. */
function WarmUp() {
  const t = useT();
  const s = useStore();
  const [minutes, setMinutes] = useState(3);
  const [profileId, setProfileId] = useState(VALORANT_ID);
  const [running, setRunning] = useState(false);
  const profile = s.settings.profiles.find((p) => p.id === profileId) ?? s.settings.profiles[0];

  const launch = () =>
    getNative()
      .then((n) => n.launchGame(profile.id))
      .then(() => s.showToast({ kind: "ok", text: t("Abrindo {game}…", { game: profile.name }) }))
      .catch((e) => s.showToast({ kind: "error", text: String(e) }));

  if (running)
    return (
      <AimTrainer
        mode="flick"
        durationMs={minutes * 60_000}
        autoStart
        onFinish={() => {
          setRunning(false);
          void launch();
        }}
      />
    );

  return (
    <div className="warmup">
      <p className="meta">{t("Faz um aquecimento de flick e, quando acabar, abre o jogo sozinho.")}</p>
      <div className="row">
        <span>{t("Duração")}</span>
        <div className="seg" role="radiogroup" aria-label={t("Duração")}>
          {[2, 3, 5].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>{t("Jogo")}</span>
        <div className="seg" role="radiogroup" aria-label={t("Jogo")}>
          {s.settings.profiles.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={profile?.id === p.id} onClick={() => setProfileId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="save-row">
        <button type="button" className="btn" onClick={launch}>{t("Só abrir o jogo")}</button>
        <button type="button" className="btn primary save" onClick={() => setRunning(true)}>
          {t("Aquecer e jogar")}
        </button>
      </div>
    </div>
  );
}

export function TrainingPage() {
  const t = useT();
  const s = useStore();
  const [tab, setTab] = useState<Tab>("warmup");
  return (
    <section className="panel training" aria-label={t("Treino")}>
      <div className="section-head">
        <TargetIcon />
        <h2>{t(TABS.find((x) => x.id === tab)!.label)}</h2>
      </div>
      <div className="tabs" role="tablist" aria-label={t("Treino")}>
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === "warmup" && <WarmUp />}
        {tab === "aim" && <AimTrainer />}
        {tab === "progress" && <Progress />}
        {tab === "visibility" && <VisibilityTest />}
        {tab === "reaction" && <ReactionTest />}
        {tab === "mouse" && (
          <div className="two-col">
            <div>
              <h3>{t("Taxa de polling")}</h3>
              <PollingTest />
            </div>
            <div>
              <h3>{t("Clique duplo")}</h3>
              <DoubleClickTest />
            </div>
            <div>
              <h3>{t("Calculadora de DPI")}</h3>
              <DpiCalc />
            </div>
          </div>
        )}
        {tab === "sens" && (
          <div className="sens-moved">
            <p className="meta">{t("A sensibilidade ganhou uma aba só dela, com o teste que descobre a sua ideal.")}</p>
            <button type="button" className="btn primary" onClick={() => s.setPage("sensitivity")}>{t("Abrir Sensibilidade")}</button>
          </div>
        )}
        {tab === "crosshair" && <CrosshairLibrary />}
      </div>
      <p className="note">{t("Tudo aqui roda dentro do Goat Filter, fora do jogo. Nada é enviado ao Valorant.")}</p>
    </section>
  );
}
