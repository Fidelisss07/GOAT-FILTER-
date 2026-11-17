import { useId, useState } from "react";
import { cmPer360, convertSens, eDpi, round, SENS_GAMES } from "../lib/sens";
import { useT } from "../lib/useT";
import { ChevronDown } from "./Icons";

function GameSelect({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  const id = useId();
  return (
    <div className="conv-field">
      <label htmlFor={id}>{label}</label>
      <div className="select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {SENS_GAMES.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <ChevronDown />
      </div>
    </div>
  );
}

export function SensConverter() {
  const t = useT();
  const sensId = useId();
  const dpiId = useId();
  const [from, setFrom] = useState("cs2");
  const [to, setTo] = useState("valorant");
  const [sens, setSens] = useState("1.5");
  const [dpi, setDpi] = useState("800");
  const s = Number(sens.replace(",", "."));
  const d = Number(dpi);
  const ok = s > 0 && d > 0;
  const out = ok ? convertSens(s, from, to) : 0;

  return (
    <div className="converter">
      <div className="conv-grid">
        <GameSelect label={t("De")} value={from} onChange={setFrom} />
        <div className="conv-field">
          <label htmlFor={sensId}>{t("Sensibilidade")}</label>
          <input id={sensId} className="input" inputMode="decimal" value={sens} onChange={(e) => setSens(e.target.value)} />
        </div>
        <div className="conv-field">
          <label htmlFor={dpiId}>DPI</label>
          <input id={dpiId} className="input" inputMode="numeric" value={dpi} onChange={(e) => setDpi(e.target.value.replace(/\D/g, ""))} />
        </div>
        <GameSelect label={t("Para")} value={to} onChange={setTo} />
      </div>
      <div className="conv-result" aria-live="polite">
        <div>
          <span>{t("Sensibilidade em {game}", { game: SENS_GAMES.find((g) => g.id === to)?.name ?? "" })}</span>
          <strong>{ok ? round(out, 3) : "—"}</strong>
        </div>
        <div>
          <span>eDPI</span>
          <strong>{ok ? round(eDpi(out, d), 1) : "—"}</strong>
        </div>
        <div>
          <span>cm/360°</span>
          <strong>{ok ? round(cmPer360(s, d, from), 1) : "—"}</strong>
        </div>
      </div>
      <p className="note">{t("Mesmo DPI nos dois jogos. O cm/360° é a distância do mouse para dar uma volta inteira.")}</p>
    </div>
  );
}
