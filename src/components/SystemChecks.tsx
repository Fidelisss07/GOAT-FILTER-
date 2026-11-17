import { useEffect, useState } from "react";
import { getNative } from "../lib/native";
import { MonitorMode, WindowsTweaks } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";
import { CheckIcon } from "./Icons";

/** Linhas reais do checklist: taxa do monitor, Game DVR, HAGS e Não perturbe. */
export function SystemChecks() {
  const t = useT();
  const toast = useStore((s) => s.showToast);
  const [modes, setModes] = useState<MonitorMode[] | null>(null);
  const [tw, setTw] = useState<WindowsTweaks | null>(null);
  const [hagsAsked, setHagsAsked] = useState(false);

  const load = () => {
    void getNative().then(async (n) => {
      setModes(await n.displayModes().catch(() => []));
      setTw(await n.windowsTweaks().catch(() => ({ gameDvr: null, hags: null })));
    });
  };
  useEffect(load, []);

  const fail = (e: unknown) => toast({ kind: "error", text: String(e) });

  return (
    <>
      {(modes ?? []).map((m) =>
        m.mode ? (
          <div className="row" key={m.monitorId}>
            <span>
              {t("Taxa do monitor")}
              {modes && modes.length > 1 && <span className="pill">{m.name}</span>}
            </span>
            {m.mode.hz >= m.mode.maxHz ? (
              <span className="state on">
                <CheckIcon /> {m.mode.hz} Hz
              </span>
            ) : (
              <span className="state-group">
                <span className="state warn">{t("{a} Hz de {b} Hz", { a: m.mode.hz, b: m.mode.maxHz })}</span>
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() =>
                    getNative()
                      .then((n) => n.setRefreshRate(m.monitorId, m.mode!.maxHz))
                      .then(() => {
                        toast({ kind: "ok", text: t("Monitor em {hz} Hz.", { hz: m.mode!.maxHz }) });
                        load();
                      })
                      .catch(fail)
                  }
                >
                  {t("Usar {hz} Hz", { hz: m.mode.maxHz })}
                </button>
              </span>
            )}
          </div>
        ) : null,
      )}

      <div className="row">
        <span>{t("Gravação em segundo plano do Xbox")}</span>
        {tw?.gameDvr == null ? (
          <span className="state muted">{t("Só no Windows")}</span>
        ) : tw.gameDvr ? (
          <span className="state-group">
            <span className="state warn">{t("Ligada")}</span>
            <button
              type="button"
              className="btn small"
              onClick={() =>
                getNative()
                  .then((n) => n.setGameDvr(false))
                  .then(setTw)
                  .catch(fail)
              }
            >
              {t("Desligar")}
            </button>
          </span>
        ) : (
          <span className="state on">
            <CheckIcon /> {t("Desligada")}
          </span>
        )}
      </div>

      <div className="row">
        <span>
          {t("Agendamento de GPU por hardware")}
          <span className="pill">HAGS</span>
        </span>
        {tw?.hags == null ? (
          <span className="state muted">{t("Só no Windows")}</span>
        ) : tw.hags ? (
          <span className="state on">
            <CheckIcon /> {t("Ligado")}
          </span>
        ) : hagsAsked ? (
          <span className="state muted">{t("Reinicie o PC para valer")}</span>
        ) : (
          <button
            type="button"
            className="btn small"
            title={t("Pede permissão de administrador e vale depois de reiniciar o PC")}
            onClick={() =>
              getNative()
                .then((n) => n.requestHags(true))
                .then(() => setHagsAsked(true))
                .catch(fail)
            }
          >
            {t("Ligar")}
          </button>
        )}
      </div>

      <div className="row">
        <span>{t("Não perturbe ao jogar")}</span>
        <button
          type="button"
          className="btn small"
          title={t("No Windows 11: Notificações › Ativar o Não perturbe automaticamente › Ao jogar")}
          onClick={() => getNative().then((n) => n.openWindowsSettings("ms-settings:notifications")).catch(fail)}
        >
          {t("Abrir configuração")}
        </button>
      </div>
    </>
  );
}
