import { useEffect, useState } from "react";
import { getNative } from "../lib/native";
import { HeavyApp } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

/** Apps pesados fechados (com calma, como clicar no X) quando o jogo abre. */
export function CloseApps() {
  const t = useT();
  const s = useStore();
  const [apps, setApps] = useState<HeavyApp[] | null>(null);
  const load = () => void getNative().then((n) => n.heavyApps()).then(setApps).catch(() => setApps([]));
  useEffect(load, []);
  const chosen = new Set(s.settings.closeOnGame);
  const toggle = (exe: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(exe);
    else next.delete(exe);
    void s.updateSettings({ closeOnGame: [...next] });
  };
  // Mostra os escolhidos e os que estão abertos agora.
  const list = (apps ?? []).filter((a) => a.running || chosen.has(a.exe));
  const closeNow = () =>
    getNative()
      .then((n) => n.closeAppsNow([...chosen]))
      .then((count) => {
        s.showToast({ kind: "ok", text: t("{n} app(s) fechados.", { n: count }) });
        setTimeout(load, 1500);
      });

  return (
    <div className="close-apps">
      <p className="meta">{t("Marque os apps que o Goat Filter deve fechar quando o jogo abrir. Ele fecha como se você clicasse no X, nunca à força.")}</p>
      {apps && list.length === 0 && <p className="note">{t("Nenhum app pesado aberto agora.")}</p>}
      <div className="rows">
        {list.map((a) => (
          <label key={a.exe} className="row check-row">
            <span>
              {a.name}
              {a.running && <span className="pill">{t("aberto")}</span>}
            </span>
            <input type="checkbox" checked={chosen.has(a.exe)} onChange={(e) => toggle(a.exe, e.target.checked)} />
          </label>
        ))}
      </div>
      {chosen.size > 0 && (
        <button type="button" className="btn small" onClick={closeNow}>
          {t("Fechar agora")}
        </button>
      )}
    </div>
  );
}
