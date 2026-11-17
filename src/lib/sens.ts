/**
 * Conversor de sensibilidade. Cada jogo gira um ângulo fixo (yaw, em graus)
 * por contagem do mouse multiplicado pela sensibilidade.
 */
export interface SensGame {
  id: string;
  name: string;
  yaw: number;
}

export const SENS_GAMES: SensGame[] = [
  { id: "valorant", name: "Valorant", yaw: 0.07 },
  { id: "cs2", name: "Counter-Strike 2", yaw: 0.022 },
  { id: "apex", name: "Apex Legends", yaw: 0.022 },
  { id: "overwatch", name: "Overwatch 2", yaw: 0.0066 },
];

const game = (id: string) => SENS_GAMES.find((g) => g.id === id) ?? SENS_GAMES[0];

/** Mesma rotação em outro jogo (mesmo DPI). */
export function convertSens(sens: number, from: string, to: string): number {
  return (sens * game(from).yaw) / game(to).yaw;
}

/** Centímetros de mouse para uma volta de 360°. */
export function cmPer360(sens: number, dpi: number, gameId: string): number {
  if (sens <= 0 || dpi <= 0) return 0;
  return (360 / (game(gameId).yaw * sens * dpi)) * 2.54;
}

export const eDpi = (sens: number, dpi: number) => sens * dpi;

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
