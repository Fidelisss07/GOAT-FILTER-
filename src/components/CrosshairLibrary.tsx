import { useId, useState } from "react";
import { Crosshair, isCrosshairCode } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";
import { TrashIcon } from "./Icons";

/** Biblioteca de códigos de mira do Valorant: salvar, copiar e colar no jogo. */
export function CrosshairLibrary() {
  const t = useT();
  const s = useStore();
  const list = s.settings.crosshairs;
  const nameId = useId();
  const codeId = useId();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const c = code.trim();
    if (!name.trim()) return setError(t("Dê um nome para a mira."));
    if (!isCrosshairCode(c)) return setError(t("Código inválido. No Valorant: Configurações › Mira › Importar/Exportar perfil › copiar."));
    const item: Crosshair = { id: `mira-${Date.now().toString(36)}`, name: name.trim(), code: c };
    void s.updateSettings({ crosshairs: [...list, item] });
    setName("");
    setCode("");
    setError(null);
  };

  const copy = async (c: Crosshair) => {
    try {
      await navigator.clipboard.writeText(c.code);
      s.showToast({ kind: "ok", text: t("Código de \"{name}\" copiado. No Valorant: Mira › Importar perfil.", { name: c.name }) });
    } catch {
      s.showToast({ kind: "error", text: t("Não foi possível copiar.") });
    }
  };

  return (
    <div className="crosshairs">
      <div className="xh-form">
        <div className="conv-field">
          <label htmlFor={nameId}>{t("Nome")}</label>
          <input id={nameId} className="input" value={name} placeholder={t("Ex.: Minha mira")} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="conv-field grow">
          <label htmlFor={codeId}>{t("Código da mira")}</label>
          <input
            id={codeId}
            className="input mono"
            value={code}
            placeholder="0;P;…"
            spellCheck={false}
            aria-invalid={!!error}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="button" className="btn primary small" onClick={add}>{t("Salvar")}</button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {list.length === 0 ? (
        <p className="note">{t("Nenhuma mira salva ainda. Copie o código da sua mira no Valorant e salve aqui para trocar rápido ou mandar para amigos.")}</p>
      ) : (
        <div className="rows">
          {list.map((c) => (
            <div key={c.id} className="row xh-row">
              <span className="xh-name">
                <strong>{c.name}</strong>
                <code>{c.code}</code>
              </span>
              <span className="state-group">
                <button type="button" className="btn small" onClick={() => copy(c)}>{t("Copiar")}</button>
                <button
                  type="button"
                  className="btn small icon-only"
                  aria-label={t("Excluir {name}", { name: c.name })}
                  onClick={() => void s.updateSettings({ crosshairs: list.filter((x) => x.id !== c.id) })}
                >
                  <TrashIcon width={16} height={16} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
