import { useState } from "react";
import { VALORANT_ID } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";
import { Toggle } from "./Controls";

const LOOKS = [
  { v: 50, label: "Natural", hint: "Cores normais da tela." },
  { v: 80, label: "Vivo", hint: "Cores mais fortes; o mais usado." },
  { v: 120, label: "Super", hint: "Acima do limite do driver: inimigos saltam na tela." },
];

/** Boas-vindas em 3 passos na primeira vez que o app abre. */
export function Welcome() {
  const t = useT();
  const s = useStore();
  const [step, setStep] = useState(0);
  const st = s.settings;
  const valorant = st.profiles.find((p) => p.id === VALORANT_ID) ?? st.profiles[0];
  const [look, setLook] = useState(valorant?.vibrance ?? 80);
  const [replay, setReplay] = useState(st.recorder.replay);
  const [autostart, setAutostart] = useState(st.startWithWindows);

  const finish = async () => {
    await s.updateSettings({
      onboarded: true,
      startWithWindows: autostart,
      recorder: { ...st.recorder, replay },
      profiles: st.profiles.map((p) => (p.id === valorant?.id ? { ...p, vibrance: look } : p)),
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal welcome" role="dialog" aria-modal="true" aria-label={t("Bem-vindo ao Goat Filter")}>
        <div className="welcome-steps" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h2>{t("Bem-vindo ao Goat Filter")}</h2>
            <p className="meta">{t("Escolha como as cores ficam quando o Valorant abrir. Dá para mudar depois.")}</p>
            <div className="welcome-looks" role="radiogroup" aria-label={t("Cores no jogo")}>
              {LOOKS.map((l) => (
                <button key={l.v} type="button" role="radio" aria-checked={look === l.v} className="look" onClick={() => setLook(l.v)}>
                  <span className="swatch" style={{ filter: `saturate(${l.v / 50})` }} aria-hidden />
                  <strong>{t(l.label)}</strong>
                  <span>{t(l.hint)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>{t("Replay instantâneo")}</h2>
            <p className="meta">
              {t("Com o jogo aberto, o Goat Filter guarda os últimos segundos. Fez uma jogada boa? Aperte Alt + F8 e ela vira um clipe.")}
            </p>
            <div className="rows">
              <div className="row">
                <span>{t("Ligar o replay instantâneo")}</span>
                <Toggle label={t("Ligar o replay instantâneo")} checked={replay} onChange={setReplay} />
              </div>
            </div>
            <p className="note">{t("Usa o chip de vídeo da placa: o FPS quase não muda. Dá para trocar a tecla na aba Gravação.")}</p>
          </>
        )}

        {step === 2 && (
          <>
            <h2>{t("Tudo pronto")}</h2>
            <p className="meta">{t("O Goat Filter fica na bandeja do Windows e liga sozinho quando o jogo abre.")}</p>
            <div className="rows">
              <div className="row">
                <span>{t("Abrir com o Windows")}</span>
                <Toggle label={t("Abrir com o Windows")} checked={autostart} onChange={setAutostart} />
              </div>
            </div>
            <p className="note">{t("Nada aqui mexe no jogo: as cores mudam pelo driver da placa ou pelo Windows.")}</p>
          </>
        )}

        <div className="save-row">
          <button type="button" className="btn link" onClick={() => s.updateSettings({ onboarded: true })}>
            {t("Pular")}
          </button>
          {step > 0 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              {t("Voltar")}
            </button>
          )}
          {step < 2 ? (
            <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
              {t("Próximo")}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={finish}>
              {t("Começar")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
