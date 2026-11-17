import { getNative } from "../lib/native";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

/**
 * Atualização dentro do próprio app: mostra a versão nova, baixa com
 * progresso, instala e reabre. A versão portátil só leva à página de download.
 */
export function UpdateActions({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const t = useT();
  const u = s.update;
  const pending = s.updater.pending;
  const installed = s.updater.installed;
  const progress = s.updateProgress;
  const version = pending ?? u?.latest ?? "";
  const notes = !compact && u?.notes ? u.notes.split("\n").filter(Boolean) : [];

  return (
    <div className={`update-box ${compact ? "compact" : ""}`} role="status">
      <div className="update-text">
        <strong>
          {pending ? t("Versão {v} pronta para instalar", { v: version }) : t("Nova versão {v} disponível", { v: version })}
        </strong>
        {notes.length > 0 && (
          <ul className="update-notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {progress != null && (
          <div className="update-progress" aria-label={t("Baixando atualização")}>
            <div className="bar">
              <div className="fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress < 100 ? t("Baixando… {p}%", { p: progress }) : t("Instalando e reabrindo…")}</span>
          </div>
        )}
      </div>
      <div className="update-actions">
        {installed ? (
          <button type="button" className="btn primary small" disabled={progress != null} onClick={s.updateNow}>
            {pending ? t("Reiniciar e atualizar") : t("Atualizar agora")}
          </button>
        ) : (
          <button type="button" className="btn small" onClick={() => getNative().then((n) => n.openRelease(u?.url ?? null))}>
            {t("Baixar a versão nova")}
          </button>
        )}
        {compact && (
          <button type="button" className="btn link" onClick={s.dismissUpdate}>
            {t("Mais tarde")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Aviso no topo do app, em qualquer aba. */
export function UpdateBanner() {
  const s = useStore();
  const show = (s.updater.pending || s.update?.available) && !s.updateDismissed;
  if (!show) return null;
  return (
    <div className="update-banner">
      <UpdateActions compact />
    </div>
  );
}
