import { useEffect, useId, useRef, useState } from "react";
import { getNative } from "../lib/native";
import { formatClock } from "../lib/rec";
import { ClipInfo } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

/** Editor de um clipe: assistir, cortar, renomear e gerar versões. */
export function ClipEditor({ clip, onClose, onChanged }: { clip: ClipInfo; onClose(): void; onChanged(): void }) {
  const t = useT();
  const s = useStore();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [markers, setMarkers] = useState<number[]>([]);
  const [name, setName] = useState(clip.name.replace(/\.mp4$/i, ""));
  const [busy, setBusy] = useState<string | null>(null);
  const nameId = useId();
  const startId = useId();
  const endId = useId();
  const discord = !!s.settings.recorder.discordWebhook;

  useEffect(() => {
    void getNative().then(async (n) => {
      setSrc(await n.videoSrc(clip.path).catch(() => null));
      setMarkers(await n.clipMarkers(clip.path).catch(() => []));
    });
  }, [clip.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const seek = (secs: number) => {
    if (video.current) video.current.currentTime = secs;
  };

  const run = async (label: string, job: () => Promise<string | void>, done: (r: string | void) => string) => {
    setBusy(label);
    try {
      const r = await job();
      s.showToast({ kind: "ok", text: done(r) });
      onChanged();
    } catch (e) {
      s.showToast({ kind: "error", text: String(e) });
    } finally {
      setBusy(null);
    }
  };
  const fileName = (p: string | void) => (p ?? "").split(/[\\/]/).pop() ?? "";

  const [a, b] = range;
  const max = duration || 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal clip-editor" role="dialog" aria-modal="true" aria-label={t("Editar clipe")}>
        <div className="section-head">
          <h2>{t("Editar clipe")}</h2>
          <button type="button" className="btn small" onClick={onClose} disabled={!!busy}>
            {t("Fechar")}
          </button>
        </div>

        {src ? (
          <video
            ref={video}
            className="clip-video"
            src={src}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration || 0;
              setDuration(d);
              setRange([0, Math.round(d * 10) / 10]);
            }}
          />
        ) : (
          <div className="clip-video placeholder">{t("A prévia aparece no aplicativo instalado.")}</div>
        )}

        {markers.length > 0 && (
          <div className="markers" aria-label={t("Marcadores")}>
            <span className="meta">{t("Marcadores")}:</span>
            {markers.map((m) => (
              <button key={m} type="button" className="btn small" onClick={() => seek(m)}>
                {formatClock(Math.floor(m))}
              </button>
            ))}
          </div>
        )}

        <div className="trim">
          <div className="conv-field">
            <label htmlFor={startId}>{t("Início")}</label>
            <input
              id={startId}
              className="input"
              type="number"
              min={0}
              step={0.1}
              value={a}
              onChange={(e) => setRange([Math.max(0, Math.min(Number(e.target.value), b - 0.5)), b])}
            />
          </div>
          <button type="button" className="btn small" disabled={!src} onClick={() => setRange([Math.round((video.current?.currentTime ?? 0) * 10) / 10, b])}>
            {t("Usar tempo atual")}
          </button>
          <div className="conv-field">
            <label htmlFor={endId}>{t("Fim")}</label>
            <input
              id={endId}
              className="input"
              type="number"
              min={0}
              max={max || undefined}
              step={0.1}
              value={b}
              onChange={(e) => setRange([a, Math.max(a + 0.5, Number(e.target.value))])}
            />
          </div>
          <button type="button" className="btn small" disabled={!src} onClick={() => setRange([a, Math.round((video.current?.currentTime ?? 0) * 10) / 10])}>
            {t("Usar tempo atual")}
          </button>
          <button
            type="button"
            className="btn primary small"
            disabled={!!busy || b - a < 0.5}
            onClick={() =>
              run(t("Cortando…"), async () => (await getNative()).trimClip(clip.path, a, b), (p) => t("Corte salvo: {name}", { name: fileName(p) }))
            }
          >
            {t("Salvar corte")}
          </button>
        </div>
        <p className="note">{t("Corte rápido, sem perder qualidade. Pode começar até 2 s antes do ponto escolhido.")}</p>

        <div className="clip-actions">
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => run(t("Gerando vertical…"), async () => (await getNative()).verticalClip(clip.path), (p) => t("Vertical salvo: {name}", { name: fileName(p) }))}
          >
            {t("Vertical (TikTok, Reels, Shorts)")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => run(t("Comprimindo…"), async () => (await getNative()).compressClip(clip.path, 10), (p) => t("Versão de 10 MB salva: {name}", { name: fileName(p) }))}
          >
            {t("Comprimir 10 MB (Discord)")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => run(t("Comprimindo…"), async () => (await getNative()).compressClip(clip.path, 25), (p) => t("Versão de 25 MB salva: {name}", { name: fileName(p) }))}
          >
            {t("Comprimir 25 MB")}
          </button>
          {discord && (
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => run(t("Enviando…"), async () => (await getNative()).sendClipDiscord(clip.path), () => t("Enviado para o Discord."))}
            >
              {t("Enviar para o Discord")}
            </button>
          )}
        </div>

        <div className="rename">
          <div className="conv-field grow">
            <label htmlFor={nameId}>{t("Nome")}</label>
            <input id={nameId} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn small"
            disabled={!!busy || !name.trim() || `${name.trim()}.mp4` === clip.name}
            onClick={() =>
              run(t("Renomeando…"), async () => (await getNative()).renameClip(clip.path, name), () => t("Nome trocado.")).then(onClose)
            }
          >
            {t("Renomear")}
          </button>
        </div>

        {busy && (
          <p className="note busy" aria-live="polite">
            {busy}
          </p>
        )}
      </div>
    </div>
  );
}
