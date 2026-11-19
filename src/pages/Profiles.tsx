import { decodeProfile, encodeProfile } from "../lib/profileCode";
import { useEffect, useId, useRef, useState } from "react";
import { Toggle } from "../components/Controls";
import {
  ChevronDown,
  DotsIcon,
  FolderIcon,
  GameIcon,
  GamepadIcon,
  LayersIcon,
  PlusIcon,
  SlidersIcon,
  ValorantMark,
} from "../components/Icons";
import { TuningEditor } from "../components/TuningEditor";
import { VibranceSlider, vibranceMax } from "../components/VibranceSlider";
import { getNative } from "../lib/native";
import { applyPreset, matchPreset, PRESETS } from "../lib/presets";
import { FoundGame, Profile, Resolution, VALORANT_ID } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";

const PRESET_NAMES = { competitivo: "Competitivo", vibrante: "Vibrante", natural: "Natural" } as const;

/** Nome do .exe, para comparar perfis e jogos encontrados. */
const exeName = (p: string) => p.split(/[\\/]/).pop()?.toLowerCase() ?? "";

/** Menu "⋯" de cada perfil. */
function RowMenu({ profile }: { profile: Profile }) {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const isValorant = profile.id === VALORANT_ID;
  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className="dots"
        aria-label={t("Opções de {name}", { name: profile.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              s.selectProfile(profile.id);
              void s.testDraft();
            }}
          >
            {t("Testar agora")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={isValorant}
            title={isValorant ? t("O perfil do Valorant não pode ser excluído") : undefined}
            onClick={() => {
              setOpen(false);
              void s.deleteProfile(profile.id);
            }}
          >
            {t("Excluir perfil")}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Encontrar jogos instalados": lista o que não tem perfil ainda. */
function FindGames({ onClose }: { onClose(): void }) {
  const s = useStore();
  const t = useT();
  const [games, setGames] = useState<FoundGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getNative()
      .then((n) => n.findGames())
      .then(setGames)
      .catch((e) => setError(String(e)));
  }, []);
  const have = new Set(s.settings.profiles.map((p) => exeName(p.executable)));
  const [query, setQuery] = useState("");
  const all = (games ?? []).filter((g) => !have.has(exeName(g.executable)));
  const q = query.trim().toLowerCase();
  const fresh = q ? all.filter((g) => g.name.toLowerCase().includes(q) || (g.source ?? "").toLowerCase().includes(q)) : all;
  const add = (list: FoundGame[]) => void s.addProfilesFromGames(list);

  return (
    <div className="find-games" role="region" aria-label={t("Jogos instalados")}>
      <div className="find-head">
        <strong>{t("Jogos instalados")}</strong>
        <button type="button" className="btn link" onClick={onClose}>{t("Fechar")}</button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!games && !error && (
        <p className="note">{t("Procurando em todo o PC: Steam, Epic, Riot, EA, Ubisoft, GOG, Battle.net, Xbox e pastas de jogos…")}</p>
      )}
      {games && all.length > 0 && (
        <p className="note">{t("{n} jogos encontrados sem perfil.", { n: all.length })}</p>
      )}
      {all.length > 6 && (
        <input
          type="search"
          className="find-search"
          placeholder={t("Buscar jogo…")}
          aria-label={t("Buscar jogo")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {games && all.length === 0 && (
        <p className="note">
          {games.length === 0 ? t("Nenhum jogo encontrado.") : t("Todos os jogos encontrados já têm perfil.")}
        </p>
      )}
      <div className="find-list">
      {fresh.map((g) => (
        <div key={g.id} className="find-row">
          <span className="ico">{g.id === VALORANT_ID ? <ValorantMark /> : <GameIcon />}</span>
          <span className="name" title={g.executable}>
            {g.name}
            {g.source && <small className="src">{g.source === "Pasta" ? t("Pasta") : g.source}</small>}
          </span>
          <button type="button" className="btn small" onClick={() => add([g])}>{t("Adicionar")}</button>
        </div>
      ))}
      </div>
      {fresh.length > 1 && (
        <button type="button" className="btn primary small" onClick={() => add(fresh)}>
          {t("Adicionar todos ({n})", { n: fresh.length })}
        </button>
      )}
    </div>
  );
}

export function Profiles() {
  const s = useStore();
  const t = useT();
  const d = s.draft;
  const nameId = useId();
  const exeId = useId();
  const [finding, setFinding] = useState(false);
  const isNew = !!d && !s.settings.profiles.some((p) => p.id === d.id);
  const max = vibranceMax(s.capabilities);
  const targetMonitor =
    s.monitors.find((m) => m.id === s.settings.defaultMonitor)?.id ?? s.monitors.find((m) => m.primary)?.id ?? null;

  const findValorant = async () => {
    const n = await getNative();
    const path = await n.findValorant();
    if (path) s.updateDraft({ executable: path });
    else s.showToast({ kind: "info", text: t("Não encontrei o Valorant. Use o botão da pasta para escolher o VALORANT.exe.") });
  };

  const browse = async () => {
    if (!d) return;
    const n = await getNative();
    const path = await n.pickExecutable(d.executable);
    if (path) s.updateDraft({ executable: path });
  };

  const activePreset = d ? matchPreset(d.vibrance, d.tuning, max) : null;

  return (
    <div className="pf-grid">
      <section className="panel list-panel" aria-label={t("Meus perfis")}>
        <div className="section-head">
          <LayersIcon />
          <h2>{t("Meus perfis")}</h2>
          <button type="button" className="btn primary small new-btn" onClick={s.newProfile}>
            {t("Novo perfil")} <PlusIcon />
          </button>
        </div>
        <div className="profile-list">
          {s.settings.profiles.map((p) => {
            const on = p.id === s.selectedProfileId && !isNew;
            return (
              <div key={p.id} className={`profile-item ${on ? "on" : ""}`}>
                <button type="button" className="pick" aria-pressed={on} onClick={() => s.selectProfile(p.id)}>
                  <span className="ico">{p.id === VALORANT_ID ? <ValorantMark /> : <GameIcon />}</span>
                  <span className="name">{p.name}</span>
                </button>
                <RowMenu profile={p} />
              </div>
            );
          })}
          {isNew && (
            <div className="profile-item on draft">
              <span className="pick">
                <span className="ico"><PlusIcon /></span>
                <span className="name">{d?.name.trim() || t("Novo perfil")}</span>
              </span>
            </div>
          )}
        </div>
        {finding ? (
          <FindGames onClose={() => setFinding(false)} />
        ) : (
          <button type="button" className="btn small find-btn" onClick={() => setFinding(true)}>
            {t("Encontrar jogos instalados")}
          </button>
        )}
        <div className="share">
          <button type="button" className="btn link" onClick={s.exportProfiles}>{t("Exportar perfis")}</button>
          <button type="button" className="btn link" onClick={s.importProfiles}>{t("Importar perfis")}</button>
        </div>
        <ProfileCode />
      </section>

      <section className="panel editor" aria-label={t("Editar perfil")}>
        <div className="section-head">
          <GamepadIcon />
          <h2>{isNew ? t("Novo perfil") : t("Editar perfil")}</h2>
        </div>
        {d && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void s.saveDraft();
            }}
          >
            <div className="field">
              <label className="label" htmlFor={nameId}>{t("Nome do perfil")}</label>
              <input
                id={nameId}
                className="input"
                value={d.name}
                placeholder={t("Ex.: CS2")}
                aria-invalid={!!s.draftErrors.name}
                aria-describedby={s.draftErrors.name ? `${nameId}-err` : undefined}
                onChange={(e) => s.updateDraft({ name: e.target.value })}
              />
              {s.draftErrors.name && <p id={`${nameId}-err`} className="field-error">{t(s.draftErrors.name)}</p>}
            </div>

            <div className="field">
              <label className="label" htmlFor={exeId}>{t("Executável")}</label>
              <div className="exe-row">
                <input
                  id={exeId}
                  className="input"
                  value={d.executable}
                  placeholder="C:\Jogos\jogo.exe"
                  spellCheck={false}
                  aria-invalid={!!s.draftErrors.executable}
                  aria-describedby={s.draftErrors.executable ? `${exeId}-err` : undefined}
                  onChange={(e) => s.updateDraft({ executable: e.target.value })}
                />
                <button type="button" className="btn icon" aria-label={t("Procurar executável")} onClick={browse}>
                  <FolderIcon />
                </button>
              </div>
              {s.draftErrors.executable && (
                <p id={`${exeId}-err`} className="field-error">{t(s.draftErrors.executable)}</p>
              )}
              {d.id === VALORANT_ID && !s.capabilities.demo && (
                <button type="button" className="btn link" onClick={findValorant}>
                  {t("Encontrar o Valorant automaticamente")}
                </button>
              )}
            </div>

            <div className="divider-line" />

            <div className="section-head vib-head">
              <SlidersIcon />
              <h3>{t("Digital Vibrance")}</h3>
              <span className="big-value">{d.vibrance}%</span>
            </div>
            <div className="presets" role="group" aria-label={t("Presets")}>
              <span className="presets-label">{t("Presets")}</span>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset"
                  aria-pressed={activePreset === p.id}
                  onClick={() => s.updateDraft(applyPreset(p, d.tuning, max))}
                >
                  {t(PRESET_NAMES[p.id])}
                </button>
              ))}
            </div>
            <VibranceSlider
              value={d.vibrance}
              onChange={(v) => s.updateDraft({ vibrance: v })}
              capabilities={s.capabilities}
              label={t("Digital Vibrance do perfil")}
            />

            <div className="rows">
              <div className="row">
                <span>{t("Aplicar ao abrir")}</span>
                <Toggle label={t("Aplicar ao abrir")} checked={d.applyOnOpen} onChange={(v) => s.updateDraft({ applyOnOpen: v })} />
              </div>
              <div className="row">
                <span>{t("Restaurar ao fechar")}</span>
                <Toggle label={t("Restaurar ao fechar")} checked={d.restoreOnClose} onChange={(v) => s.updateDraft({ restoreOnClose: v })} />
              </div>
              <div className="row">
                <span>
                  {t("Só com o jogo em foco")}
                  <span className="pill">{t("alt-tab volta ao normal")}</span>
                </span>
                <Toggle label={t("Só com o jogo em foco")} checked={d.focusOnly} onChange={(v) => s.updateDraft({ focusOnly: v })} />
              </div>
            </div>

            <StretchPicker />

            <details
              className="advanced"
              open={d.tuning.emphasis !== "none" || d.tuning.gamma !== 100 || d.tuning.brightness !== 0 || d.tuning.contrast !== 100}
            >
              <summary>{t("Ajustes finos")}</summary>
              <TuningEditor
                tuning={d.tuning}
                onChange={(tuning) => s.updateDraft({ tuning })}
                capabilities={s.capabilities}
                monitorId={targetMonitor}
              />
            </details>

            <div className="save-row">
              <button type="button" className="btn test" onClick={s.testDraft}>{t("Testar agora")}</button>
              <button type="submit" className="btn primary save">{t("Salvar perfil")}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

/** Código curto para mandar a configuração de cor do perfil para amigos. */
function ProfileCode() {
  const s = useStore();
  const t = useT();
  const [code, setCode] = useState("");
  const d = s.draft;
  if (!d) return null;
  const copy = () => {
    const c = encodeProfile(d);
    navigator.clipboard
      .writeText(c)
      .then(() => s.showToast({ kind: "ok", text: t("Código copiado: {code}", { code: c }) }))
      .catch(() => s.showToast({ kind: "error", text: t("Não foi possível copiar.") }));
  };
  const apply = () => {
    const r = decodeProfile(code);
    if (!r) {
      s.showToast({ kind: "error", text: t("Código inválido. Ele começa com GF1-.") });
      return;
    }
    s.updateDraft({ vibrance: r.vibrance, tuning: { ...r.tuning, monitorBrightness: d.tuning.monitorBrightness, monitorContrast: d.tuning.monitorContrast, monitorSaturation: d.tuning.monitorSaturation } });
    setCode("");
    s.showToast({ kind: "ok", text: t("Código aplicado em \"{name}\". Salve o perfil para manter.", { name: d.name }) });
  };
  return (
    <div className="profile-code">
      <button type="button" className="btn small" onClick={copy}>
        {t("Copiar código do perfil")}
      </button>
      <div className="hook-row">
        <input
          className="input mono"
          aria-label={t("Colar código de perfil")}
          placeholder="GF1-…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="button" className="btn small" disabled={!code.trim()} onClick={apply}>
          {t("Aplicar")}
        </button>
      </div>
    </div>
  );
}

/** Resolução esticada (ex.: 4:3) enquanto o jogo do perfil está aberto. */
function StretchPicker() {
  const s = useStore();
  const t = useT();
  const id = useId();
  const [opts, setOpts] = useState<Resolution[]>([]);
  useEffect(() => {
    void getNative()
      .then((n) => n.stretchOptions())
      .then(setOpts)
      .catch(() => setOpts([]));
  }, []);
  const d = s.draft;
  if (!d) return null;
  const value = d.stretch ? `${d.stretch.width}x${d.stretch.height}` : "";
  const missing = d.stretch && !opts.some((o) => o.width === d.stretch!.width && o.height === d.stretch!.height);
  return (
    <div className="stretch">
      <div className="row">
        <label htmlFor={id}>{t("Resolução esticada")}</label>
        <div className="row-ctl select stretch-select">
          <select
            id={id}
            value={value}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              s.updateDraft({ stretch: e.target.value ? { width: w, height: h } : null });
            }}
          >
            <option value="">{t("Desligada (resolução normal)")}</option>
            {missing && <option value={value}>{value}</option>}
            {opts.map((o) => (
              <option key={`${o.width}x${o.height}`} value={`${o.width}x${o.height}`}>
                {o.width}×{o.height} · {o.aspect} · {o.maxHz} Hz
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
      </div>
      {d.stretch && (
        <div className="stretch-info">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              getNative()
                .then((n) => n.testStretch(d.stretch!.width, d.stretch!.height))
                .then(() => s.showToast({ kind: "ok", text: t("Tela esticada por 10 segundos.") }))
                .catch((e) => s.showToast({ kind: "error", text: String(e) }))
            }
          >
            {t("Testar por 10 s")}
          </button>
          <p className="note">
            {t("Quando o jogo abrir, o Windows muda para essa resolução com a imagem esticada, e volta ao normal quando ele fechar. No Valorant, use “Tela cheia em janela”. Se aparecerem barras pretas, ative “Tela cheia” em Ajustar tamanho e posição da área de trabalho, no painel da NVIDIA ou no Adrenalin da AMD.")}
          </p>
        </div>
      )}
    </div>
  );
}
