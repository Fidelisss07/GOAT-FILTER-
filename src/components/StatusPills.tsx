import { useEffect, useState } from "react";
import { getNative } from "../lib/native";
import { RecorderStatus } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore, valorantProfile } from "../state/store";

/** Pílulas de status no topo: jogo detectado e replay (atualiza a cada 2 s). */
export function StatusPills() {
  const t = useT();
  const game = useStore((s) => s.game);
  const valorant = useStore(valorantProfile);
  const rec = useStore((s) => s.settings.recorder);
  const setPage = useStore((s) => s.setPage);
  const [st, setSt] = useState<RecorderStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      getNative()
        .then((n) => n.recorderStatus())
        .then((r) => alive && setSt(r))
        .catch(() => alive && setSt(null));
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  let gameText: string;
  let gameKind = "";
  if (game.state === "unavailable") {
    gameText = t("Detecção indisponível");
    gameKind = "muted";
  } else if (game.state === "paused") {
    gameText = t("Valorant em segundo plano");
  } else if (game.state === "active") {
    gameText = game.profileId === valorant?.id ? t("Valorant aberto · {v}% aplicado", { v: valorant?.vibrance ?? 0 }) : t("Perfil ativo");
    gameKind = "live";
  } else {
    gameText = t("Aguardando o jogo abrir · {v}%", { v: valorant?.vibrance ?? 0 });
    gameKind = "wait";
  }

  const replayOn = !!st?.running;
  return (
    <div className="status-pills">
      <span className={`glass chip ${gameKind}`} title={game.message ?? undefined}>
        <i className="chip-dot" aria-hidden />
        {gameText}
      </span>
      {st?.available && (
        <button type="button" className={`glass chip ${replayOn ? "rec" : "muted"}`} onClick={() => setPage("recording")}>
          <i className="chip-dot" aria-hidden />
          {replayOn ? t("Replay · {s} s", { s: rec.clipSeconds }) : t("Replay desligado")}
        </button>
      )}
    </div>
  );
}
