import { useCallback, useEffect, useId, useState } from "react";
import { ToggleRow } from "../components/Controls";
import { ChevronDown, FolderIcon, RecordIcon, SlidersIcon, TrashIcon } from "../components/Icons";
import { KeyCapture } from "../components/KeyCapture";
import { getNative } from "../lib/native";
import { bitrateKbps, clipMegabytes, formatClock, formatSize, outputSize } from "../lib/rec";
import { Bindings, CLIP_CHOICES, ClipInfo, RecQuality, RecorderSettings, RecorderStatus } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

const QUALITIES: { id: RecQuality; label: string }[] = [
  { id: "light", label: "Leve" },
  { id: "balanced", label: "Equilibrada" },
  { id: "high", label: "Alta" },
];

const HEIGHTS: { h: number; label: string }[] = [
  { h: 720, label: "720p" },
  { h: 1080, label: "1080p" },
  { h: 1440, label: "1440p (2K)" },
];

const BIND_LABELS: Record<keyof Bindings, string> = {
  toggle: "Ligar / desligar o filtro",
  vibranceUp: "Subir vibrância",
  vibranceDown: "Descer vibrância",
  nextProfile: "Próximo perfil",
  saveClip: "Salvar clipe",
  toggleRecord: "Gravar / parar",
};

function useRecorder() {
  const [st, setSt] = useState<RecorderStatus | null>(null);
  const refresh = useCallback(
    () =>
      getNative()
        .then((n) => n.recorderStatus())
        .then(setSt)
        .catch(() => setSt(null)),
    [],
  );
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);
  return { st, refresh };
}

function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="row">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} disabled={disabled} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ st, rec }: { st: RecorderStatus | null; rec: RecorderSettings }) {
  const t = useT();
  if (!st) return null;
  if (!st.available) return <span className="pill">{t("Indisponível")}</span>;
  if (st.starting) return <span className="pill">{t("Preparando…")}</span>;
  if (st.running) return <span className="pill accent rec-dot">{t("Ligado")}</span>;
  if (rec.replay && rec.onlyInGame) return <span className="pill">{t("Esperando o jogo abrir")}</span>;
  return <span className="pill">{t("Desligado")}</span>;
}

export function RecordingPage() {
  const s = useStore();
  const t = useT();
  const rec = s.settings.recorder;
  const b = s.settings.bindings;
  const { st, refresh } = useRecorder();
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [mics, setMics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const micId = useId();

  const set = (patch: Partial<RecorderSettings>) => s.updateSettings({ recorder: { ...rec, ...patch } }).then(refresh);
  const loadClips = useCallback(
    () =>
      getNative()
        .then((n) => n.listClips())
        .then(setClips)
        .catch(() => setClips([])),
    [],
  );

  useEffect(() => {
    void loadClips();
    getNative()
      .then((n) => n.listMicrophones())
      .then(setMics)
      .catch(() => setMics([]));
    let off: (() => void) | undefined;
    void getNative()
      .then((n) => n.onClipsChanged(loadClips))
      .then((f) => (off = f));
    return () => off?.();
  }, [loadClips]);

  const fail = (e: unknown) => s.showToast({ kind: "error", text: String(e) });

  const saveNow = async (secs?: number) => {
    setBusy(true);
    try {
      const n = await getNative();
      const path = await n.saveClip(secs);
      s.showToast({ kind: "ok", text: t("Clipe salvo: {name}", { name: path.split(/[\\/]/).pop() ?? path }) });
      await loadClips();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleRecord = async () => {
    setBusy(true);
    try {
      const n = await getNative();
      if (st?.recordingSecs != null) {
        const path = await n.stopRecording();
        s.showToast({ kind: "ok", text: t("Gravação salva: {name}", { name: path.split(/[\\/]/).pop() ?? path }) });
        await loadClips();
      } else {
        await n.startRecording();
      }
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const conflict = (key: keyof Bindings) => {
    const other = (Object.keys(b) as (keyof Bindings)[]).find((k) => k !== key && b[k] && b[k] === b[key]);
    return other ? t("Mesma tecla de \"{name}\".", { name: t(BIND_LABELS[other]) }) : null;
  };

  // Estimativa para a tela de 2560x1440 ou a altura escolhida.
  const [w, h] = st?.size ? (st.size.split("x").map(Number) as [number, number]) : outputSize(rec.maxHeight * (16 / 9), rec.maxHeight, rec.maxHeight);
  const mb = clipMegabytes(bitrateKbps(w, h, rec.fps, rec.quality), rec.clipSeconds);
  const recording = st?.recordingSecs != null;
  const unavailable = st != null && !st.available;

  return (
    <div className="perf-grid">
      <div className="stack">
        <section className="panel" aria-label={t("Replay instantâneo")}>
          <div className="section-head">
            <RecordIcon />
            <h2>{t("Replay instantâneo")}</h2>
            <StatusPill st={st} rec={rec} />
          </div>
          <p className="meta">{t("Guarda os últimos segundos o tempo todo. Aconteceu uma jogada boa? Aperte o atalho e ela vira um clipe.")}</p>
          {unavailable && <p className="field-error">{t("O gravador não está disponível nesta versão.")}</p>}
          {st?.error && <p className="field-error">{st.error}</p>}
          <div className="rows">
            <ToggleRow label={t("Replay instantâneo")} checked={rec.replay} disabled={unavailable} onChange={(v) => set({ replay: v })} />
            <ToggleRow label={t("Só com o jogo aberto")} checked={rec.onlyInGame} disabled={unavailable} onChange={(v) => set({ onlyInGame: v })} />
            <Seg
              label={t("Duração do clipe")}
              value={rec.clipSeconds}
              options={CLIP_CHOICES.map((c) => ({ id: c, label: `${c}s` }))}
              onChange={(v) => set({ clipSeconds: v })}
            />
            <KeyCapture
              label={t("Salvar clipe")}
              allowBare
              value={b.saveClip}
              disabled={!s.settings.hotkeys}
              conflict={conflict("saveClip")}
              onChange={(v) => s.updateSettings({ bindings: { ...b, saveClip: v } })}
            />
          </div>
          <p className="note">{t("Pode ser uma tecla sozinha, como F8, Insert ou uma do teclado numérico.")}</p>
          <div className="section">
            <div className="section-head">
              <h3>{t("Salvar agora")}</h3>
            </div>
            <div className="seg clip-now" aria-label={t("Salvar agora")}>
              {[15, 20, 25, 30, 35].map((n) => (
                <button key={n} type="button" disabled={busy || !st?.running} onClick={() => saveNow(n)}>
                  {t("Últimos {n}s", { n })}
                </button>
              ))}
            </div>
            {st?.running && (
              <p className="note">
                {st.encoder} {st.hardware ? `(${t("placa de vídeo")})` : ""} · {st.size} · {st.fps} fps ·{" "}
                {t("{n} s guardados", { n: st.bufferedSecs })}
              </p>
            )}
          </div>
        </section>

        <section className="panel" aria-label={t("Gravar gameplay")}>
          <div className="section-head">
            <RecordIcon />
            <h2>{t("Gravar gameplay")}</h2>
            {recording && <span className="pill accent rec-dot">{formatClock(st!.recordingSecs!)}</span>}
          </div>
          <p className="meta">{t("Grava até você parar. Usa a mesma captura do replay, então não pesa em dobro.")}</p>
          <button type="button" className={`btn block ${recording ? "" : "primary"} rec-btn`} disabled={busy || unavailable} onClick={toggleRecord}>
            {recording ? t("Parar e salvar") : t("Começar a gravar")}
          </button>
          <div className="rows">
            <KeyCapture
              label={t("Gravar / parar")}
              allowBare
              value={b.toggleRecord}
              disabled={!s.settings.hotkeys}
              conflict={conflict("toggleRecord")}
              onChange={(v) => s.updateSettings({ bindings: { ...b, toggleRecord: v } })}
            />
          </div>
          {!s.settings.hotkeys && <p className="note">{t("Os atalhos estão desligados na aba Desempenho.")}</p>}
        </section>
      </div>

      <div className="stack">
        <section className="panel" aria-label={t("Qualidade")}>
          <div className="section-head">
            <SlidersIcon />
            <h2>{t("Qualidade")}</h2>
          </div>
          <div className="rows">
            <Seg label={t("Resolução")} value={rec.maxHeight} options={HEIGHTS.map((x) => ({ id: x.h, label: x.label }))} onChange={(v) => set({ maxHeight: v })} />
            <Seg label="FPS" value={rec.fps} options={[{ id: 30, label: "30" }, { id: 60, label: "60" }]} onChange={(v) => set({ fps: v })} />
            <Seg label={t("Qualidade")} value={rec.quality} options={QUALITIES.map((q) => ({ id: q.id, label: t(q.label) }))} onChange={(v) => set({ quality: v })} />
            <ToggleRow label={t("Som do PC")} checked={rec.systemAudio} onChange={(v) => set({ systemAudio: v })} />
            <div className="row">
              <label htmlFor={micId}>{t("Microfone")}</label>
              <div className="select mic-select">
                <select id={micId} value={rec.mic} onChange={(e) => set({ mic: e.target.value })}>
                  <option value="">{t("Sem microfone")}</option>
                  {rec.mic && !mics.includes(rec.mic) && <option value={rec.mic}>{rec.mic}</option>}
                  {mics.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown />
              </div>
            </div>
          </div>
          <p className="note">
            {t("Clipe de {s}s ≈ {mb} MB.", { s: rec.clipSeconds, mb })}{" "}
            {t("Usa o chip de vídeo da placa (NVIDIA, AMD ou Intel), separado do que roda o jogo: o FPS quase não muda.")}
          </p>
        </section>

        <section className="panel" aria-label={t("Clipes")}>
          <div className="section-head">
            <FolderIcon />
            <h2>{t("Clipes")}</h2>
            <button type="button" className="btn small" onClick={() => getNative().then((n) => n.revealClip()).catch(fail)}>
              {t("Abrir pasta")}
            </button>
          </div>
          <div className="row folder-row">
            <span className="folder-path" title={st?.folder}>{st?.folder ?? ""}</span>
            <span className="state-group">
              <button
                type="button"
                className="btn small"
                onClick={async () => {
                  const n = await getNative();
                  const dir = await n.pickFolder(rec.folder || st?.folder || "");
                  if (dir) await set({ folder: dir });
                }}
              >
                {t("Trocar")}
              </button>
              {rec.folder && (
                <button type="button" className="btn small" onClick={() => set({ folder: "" })}>
                  {t("Padrão")}
                </button>
              )}
            </span>
          </div>
          {clips.length === 0 ? (
            <p className="note">{t("Nenhum clipe ainda.")}</p>
          ) : (
            <ul className="clips" aria-label={t("Clipes salvos")}>
              {clips.slice(0, 30).map((c) => (
                <li key={c.path} className="row clip-row">
                  <span className="clip-name">
                    <strong>{c.name.replace(/\.mp4$/i, "")}</strong>
                    <small>
                      {formatSize(c.size)} · {new Date(c.modified).toLocaleString()}
                    </small>
                  </span>
                  <span className="state-group">
                    <button type="button" className="btn small" onClick={() => getNative().then((n) => n.openClip(c.path)).catch(fail)}>
                      {t("Assistir")}
                    </button>
                    <button type="button" className="btn small" onClick={() => getNative().then((n) => n.revealClip(c.path)).catch(fail)}>
                      {t("Mostrar")}
                    </button>
                    <button
                      type="button"
                      className="btn small icon-only"
                      aria-label={t("Excluir {name}", { name: c.name })}
                      onClick={() =>
                        getNative()
                          .then((n) => n.deleteClip(c.path))
                          .then(loadClips)
                          .catch(fail)
                      }
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
