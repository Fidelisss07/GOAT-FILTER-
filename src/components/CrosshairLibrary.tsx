import { useId, useMemo, useState } from "react";
import { CROSSHAIR_PRESETS, CROSSHAIR_SOURCES, CrosshairPreset, crosshairRects, parseCrosshair, PresetKind } from "../lib/crosshair";
import { GenPreset, generatedCrosshairs, XH_COLORS, XH_FAMILIES, XhFamily } from "../lib/crosshairGen";
import { Crosshair, isCrosshairCode } from "../lib/types";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";
import { TrashIcon } from "./Icons";

/** Desenho da mira a partir do código (prévia em escala). */
export function CrosshairPreview({ code, size = 96 }: { code: string; size?: number }) {
  const rects = useMemo(() => {
    try {
      return crosshairRects(parseCrosshair(code));
    } catch {
      return [];
    }
  }, [code]);
  const view = 40; // pixels do jogo mostrados (−20..20)
  return (
    <svg className="xh-preview" width={size} height={size} viewBox={`${-view / 2} ${-view / 2} ${view} ${view}`} shapeRendering="crispEdges" aria-hidden>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} fillOpacity={r.alpha} />
      ))}
    </svg>
  );
}

/** Quantas miras aparecem por vez (mais leve com 1500+). */
const PAGE = 60;

const KINDS: { id: PresetKind | "todas"; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "pro", label: "Pros" },
  { id: "estilo", label: "Estilos" },
  { id: "divertida", label: "Divertidas" },
];

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

  const [kind, setKind] = useState<PresetKind | "todas">("todas");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<XhFamily | "">("");
  const [color, setColor] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo<(CrosshairPreset | GenPreset)[]>(() => [...CROSSHAIR_PRESETS, ...generatedCrosshairs()], []);
  const colorName = (id: string) => XH_COLORS.find((c) => c.id === id)?.name ?? id;
  /** Nome na língua do app: as geradas montam o nome com partes traduzidas. */
  const label = (p: CrosshairPreset | GenPreset) =>
    "family" in p ? `${t(XH_FAMILIES[p.family])} ${t(colorName(p.color))} ${p.detail}` : p.name;
  const q = query.trim().toLowerCase();
  const presets = all.filter((p) => {
    if (kind !== "todas" && p.kind !== kind) return false;
    if (family && (!("family" in p) || p.family !== family)) return false;
    if (color && (!("family" in p) || p.color !== color)) return false;
    return !q || `${label(p)} ${p.name} ${t(p.info)}`.toLowerCase().includes(q);
  });
  const shown = presets.slice(0, limit);
  const saved = (code: string) => list.some((x) => x.code === code);
  const savePreset = (name: string, code: string) => {
    if (saved(code)) return;
    void s.updateSettings({ crosshairs: [...list, { id: `mira-${Date.now().toString(36)}`, name, code }] });
    s.showToast({ kind: "ok", text: t("\"{name}\" salva em Minhas miras.", { name }) });
  };

  const copy = async (c: Pick<Crosshair, "name" | "code">) => {
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
              <CrosshairPreview code={c.code} size={52} />
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

      <div className="section xh-presets">
        <div className="section-head">
          <h3>{t("Miras prontas")}</h3>
          <span className="pill">{all.length}</span>
        </div>
        <div className="xh-filter">
          <div className="seg" role="radiogroup" aria-label={t("Tipo de mira")}>
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => { setKind(k.id); setLimit(PAGE); }}>
                {t(k.label)}
              </button>
            ))}
          </div>
          <input className="input" aria-label={t("Buscar mira")} placeholder={t("Buscar (ex.: TenZ, ponto)")} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
        </div>
        <div className="xh-filter">
          <div className="select small-select">
            <select aria-label={t("Estilo")} value={family} onChange={(e) => { setFamily(e.target.value as XhFamily | ""); setLimit(PAGE); }}>
              <option value="">{t("Todos os estilos")}</option>
              {(Object.keys(XH_FAMILIES) as XhFamily[]).map((f) => (
                <option key={f} value={f}>
                  {t(XH_FAMILIES[f])}
                </option>
              ))}
            </select>
          </div>
          <div className="xh-colors" role="radiogroup" aria-label={t("Cor")}>
            <button type="button" role="radio" aria-checked={color === ""} className="xh-color all" onClick={() => { setColor(""); setLimit(PAGE); }}>
              {t("Todas")}
            </button>
            {XH_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                aria-label={t(c.name)}
                title={t(c.name)}
                className="xh-color"
                style={{ background: c.swatch }}
                onClick={() => { setColor(c.id); setLimit(PAGE); }}
              />
            ))}
          </div>
          <span className="note">{t("{n} miras", { n: presets.length })}</span>
        </div>
        <ul className="xh-grid" aria-label={t("Miras prontas")}>
          {shown.map((p) => (
            <li key={p.code} className="xh-card">
              <CrosshairPreview code={p.code} />
              <strong>{label(p)}</strong>
              <small>{"family" in p ? t("Gerada pelo Goat Filter") : t(p.info)}</small>
              <span className="xh-actions">
                <button type="button" className="btn small" onClick={() => copy({ name: label(p), code: p.code })}>
                  {t("Copiar")}
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={saved(p.code)}
                  aria-label={t("Salvar {name} em Minhas miras", { name: label(p) })}
                  onClick={() => savePreset(label(p), p.code)}
                >
                  {saved(p.code) ? t("Salva") : t("Salvar")}
                </button>
              </span>
            </li>
          ))}
          {presets.length === 0 && <li className="note">{t("Nenhuma mira encontrada.")}</li>}
        </ul>
        {presets.length > shown.length && (
          <button type="button" className="btn block" onClick={() => setLimit(limit + PAGE * 2)}>
            {t("Mostrar mais ({n} restantes)", { n: presets.length - shown.length })}
          </button>
        )}
        <p className="note">
          {t("Reunidas de sites de miras e de configurações de pros ({sites}). Pros trocam de mira com frequência: confira no jogo.", {
            sites: CROSSHAIR_SOURCES.join(", "),
          })}
        </p>
      </div>
    </div>
  );
}
