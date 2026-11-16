import { useId } from "react";
import { Toggle } from "../components/Controls";
import { CheckIcon, FolderIcon, GameIcon, PlusIcon, TrashIcon, ValorantMark } from "../components/Icons";
import { VibranceSlider } from "../components/VibranceSlider";
import { getNative } from "../lib/native";
import { VALORANT_ID } from "../lib/types";
import { useStore } from "../state/store";

export function Profiles() {
  const s = useStore();
  const d = s.draft;
  const nameId = useId();
  const exeId = useId();
  const isNew = !!d && !s.settings.profiles.some((p) => p.id === d.id);

  const browse = async () => {
    if (!d) return;
    const n = await getNative();
    const path = await n.pickExecutable(d.executable);
    if (path) s.updateDraft({ executable: path });
  };

  return (
    <div className="profiles">
      <section className="card" aria-label="Gerenciador de perfis">
        <h2>Gerenciador de perfis</h2>
        <p className="sub">Crie, edite e organize seus perfis de jogo.</p>
        <div className="profile-list">
          {s.settings.profiles.map((p) => {
            const on = p.id === s.selectedProfileId;
            return (
              <button key={p.id} type="button" className="profile-item" aria-pressed={on} onClick={() => s.selectProfile(p.id)}>
                <span className="ico">{p.id === VALORANT_ID ? <ValorantMark /> : <GameIcon />}</span>
                <span className="name">{p.name}</span>
                {on && <CheckIcon className="check" />}
              </button>
            );
          })}
          <button type="button" className="profile-item" aria-pressed={isNew} onClick={s.newProfile}>
            <span className="ico plus"><PlusIcon /></span>
            <span className="name">Novo perfil</span>
          </button>
        </div>
      </section>

      <section className="card editor" aria-label="Editar perfil">
        <h2>{isNew ? "Novo perfil" : "Editar perfil"}</h2>
        <p className="sub">Ajuste as configurações do seu perfil.</p>
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
            </div>

            <div className="vib-head">
              <span className="label">Digital Vibrance</span>
              <span className="big-value small">{d.vibrance}%</span>
            </div>
            <VibranceSlider
              value={d.vibrance}
              onChange={(v) => s.updateDraft({ vibrance: v })}
              capabilities={s.capabilities}
              label="Digital Vibrance do perfil"
            />

            <div className="toggles">
              <div className="row">
                <span>Aplicar ao abrir</span>
                <Toggle label="Aplicar ao abrir" checked={d.applyOnOpen} onChange={(v) => s.updateDraft({ applyOnOpen: v })} />
              </div>
              <div className="row">
                <span>Restaurar ao fechar</span>
                <Toggle label="Restaurar ao fechar" checked={d.restoreOnClose} onChange={(v) => s.updateDraft({ restoreOnClose: v })} />
              </div>
            </div>

            <button type="submit" className="btn primary save">Salvar perfil</button>
            {!isNew && d.id !== VALORANT_ID && (
              <div className="foot">
                <button type="button" className="btn link" onClick={() => s.deleteProfile(d.id)}>
                  <TrashIcon width={14} height={14} /> Excluir perfil
                </button>
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
