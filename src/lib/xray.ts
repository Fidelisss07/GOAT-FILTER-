import { MonitorMode, PerfStatus, Settings, WindowsTweaks } from "./types";

export interface XrayItem {
  id: string;
  label: string;
  /** null = não dá para saber nesta máquina (não conta na nota). */
  ok: boolean | null;
  tip: string;
}

/** Itens do Raio-X a partir do que o app já sabe sobre o PC. */
export function xrayItems(input: {
  modes: MonitorMode[] | null;
  tweaks: WindowsTweaks | null;
  perf: PerfStatus | null;
  settings: Settings;
}): XrayItem[] {
  const { modes, tweaks, perf, settings } = input;
  const primary = modes?.find((m) => m.mode)?.mode ?? null;
  return [
    {
      id: "hz",
      label: "Monitor na taxa máxima",
      ok: primary ? primary.hz >= primary.maxHz : null,
      tip: "Use a taxa mais alta do monitor (ex.: 144 Hz).",
    },
    { id: "dvr", label: "Gravação do Xbox desligada", ok: tweaks?.gameDvr == null ? null : !tweaks.gameDvr, tip: "Desligue o Game DVR." },
    { id: "hags", label: "Agendamento de GPU por hardware", ok: tweaks?.hags ?? null, tip: "Ligue o HAGS e reinicie o PC." },
    { id: "gamemode", label: "Modo de Jogo do Windows", ok: perf?.gameMode ?? null, tip: "Ligue o Modo de Jogo." },
    {
      id: "power",
      label: "Alto desempenho ao jogar",
      ok: perf ? settings.perf.highPerformancePower || perf.powerHigh === true : null,
      tip: "Ligue “Plano de energia Alto desempenho” em Enquanto joga.",
    },
    {
      id: "accel",
      label: "Aceleração do mouse desligada",
      ok: perf ? settings.perf.mouseAccelOff || perf.mouseAccel === false : null,
      tip: "Ligue “Desligar aceleração do mouse” em Enquanto joga.",
    },
    {
      id: "apps",
      label: "Apps pesados fechados ao jogar",
      ok: settings.closeOnGame.length > 0,
      tip: "Escolha apps em “Fechar ao abrir o jogo”.",
    },
  ];
}

/** Nota de 0 a 100 (só com os itens que dá para medir). */
export function xrayScore(items: XrayItem[]): number | null {
  const known = items.filter((i) => i.ok != null);
  if (known.length === 0) return null;
  return Math.round((known.filter((i) => i.ok).length / known.length) * 100);
}
