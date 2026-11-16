import { useEffect, useId, useRef, useState } from "react";
import { Toggle } from "../components/Controls";
import {
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
import { VibranceSlider } from "../components/VibranceSlider";
import { getNative } from "../lib/native";
import { Profile, VALORANT_ID } from "../lib/types";
import { useStore } from "../state/store";

/** Menu "⋯" de cada perfil. */
function RowMenu({ profile }: { profile: Profile }) {
  const s = useStore();
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
        aria-label={`Opções de ${profile.name}`}
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
            Testar agora
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={isValorant}
            title={isValorant ? "O perfil do Valorant não pode ser excluído" : undefined}
            onClick={() => {
              setOpen(false);
              void s.deleteProfile(profile.id);
            }}
          >
            Excluir perfil
          </button>
        </div>
      )}
    </div>
  );
}

export function Profiles() {
  const s = useStore();
  const d = s.draft;
  const nameId = useId();
  const exeId = useId();
  const isNew = !!d && !s.settings.profiles.some((p) => p.id === d.id);
  const targetMonitor =
    s.monitors.find((m) => m.id === s.settings.defaultMonitor)?.id ?? s.monitors.find((m) => m.primary)?.id ?? null;

  const findValorant = async () => {
    const n = await getNative();
    const path = await n.findValorant();
    if (path) s.updateDraft({ executable: path });
    else s.showToast({ kind: "info", text: "Não encontrei o Valorant. Use o botão da pasta para escolher o VALORANT.exe." });
  };

  const browse = async () => {
    if (!d) return;
    const n = await getNative();
    const path = await n.pickExecutable(d.executable);
    if (path) s.updateDraft({ executable: path });
  };

  return (
    <div className="pf-grid">
      <section className="panel list-panel" aria-label="Meus perfis">
        <div className="section-head">
          <LayersIcon />
          <h2>Meus perfis</h2>
          <button type="button" className="btn primary small new-btn" onClick={s.newProfile}>
            Novo perfil <PlusIcon />
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
                <span className="name">{d?.name.trim() || "Novo perfil"}</span>
              </span>
            </div>
          )}
        </div>
        <div className="share">
          <button type="button" className="btn link" onClick={s.exportProfiles}>Exportar perfis</button>
          <button type="button" className="btn link" onClick={s.importProfiles}>Importar perfis</button>
        </div>
      </section>

      <section className="panel editor" aria-label="Editar perfil">
        <div className="section-head">
          <GamepadIcon />
          <h2>{isNew ? "Novo perfil" : "Editar perfil"}</h2>
        </div>
        {d && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void s.saveDraft();
            }}
          >
            <div className="field">
              <label className="label" htmlFor={nameId}>Nome do perfil</label>
              <input
                id={nameId}
                className="input"
                value={d.name}
                placeholder="Ex.: CS2"
                aria-invalid={!!s.draftErrors.name}
                aria-describedby={s.draftErrors.name ? `${nameId}-err` : undefined}
                onChange={(e) => s.updateDraft({ name: e.target.value })}
              />
              {s.draftErrors.name && <p id={`${nameId}-err`} className="field-error">{s.draftErrors.name}</p>}
            </div>

            <div className="field">
              <label className="label" htmlFor={exeId}>Executável</label>
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
                <button type="button" className="btn icon" aria-label="Procurar executável" onClick={browse}>
                  <FolderIcon />
                </button>
              </div>
              {s.draftErrors.executable && <p id={`${exeId}-err`} className="field-error">{s.draftErrors.executable}</p>}
              {d.id === VALORANT_ID && !s.capabilities.demo && (
                <button type="button" className="btn link" onClick={findValorant}>
                  Encontrar o Valorant automaticamente
                </button>
              )}
            </div>

            <div className="divider-line" />

            <div className="section-head vib-head">
              <SlidersIcon />
              <h3>Digital Vibrance</h3>
              <span className="big-value">{d.vibrance}%</span>
            </div>
            <VibranceSlider
              value={d.vibrance}
              onChange={(v) => s.updateDraft({ vibrance: v })}
              capabilities={s.capabilities}
              label="Digital Vibrance do perfil"
            />

            <div className="rows">
              <div className="row">
                <span>Aplicar ao abrir</span>
                <Toggle label="Aplicar ao abrir" checked={d.applyOnOpen} onChange={(v) => s.updateDraft({ applyOnOpen: v })} />
              </div>
              <div className="row">
                <span>Restaurar ao fechar</span>
                <Toggle label="Restaurar ao fechar" checked={d.restoreOnClose} onChange={(v) => s.updateDraft({ restoreOnClose: v })} />
              </div>
              <div className="row">
                <span>
                  Só com o jogo em foco
                  <span className="pill">alt-tab volta ao normal</span>
                </span>
                <Toggle label="Só com o jogo em foco" checked={d.focusOnly} onChange={(v) => s.updateDraft({ focusOnly: v })} />
              </div>
            </div>

            <details
              className="advanced"
              open={d.tuning.emphasis !== "none" || d.tuning.gamma !== 100 || d.tuning.brightness !== 0 || d.tuning.contrast !== 100}
            >
              <summary>Ajustes finos</summary>
              <TuningEditor
                tuning={d.tuning}
                onChange={(tuning) => s.updateDraft({ tuning })}
                capabilities={s.capabilities}
                monitorId={targetMonitor}
              />
            </details>

            <div className="save-row">
              <button type="button" className="btn test" onClick={s.testDraft}>Testar agora</button>
              <button type="submit" className="btn primary save">Salvar perfil</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
