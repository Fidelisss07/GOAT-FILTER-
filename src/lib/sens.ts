/**
 * Conversor de sensibilidade. Cada jogo gira um ângulo fixo (yaw, em graus)
 * por contagem do mouse multiplicado pela sensibilidade.
 */
export interface SensGame {
  id: string;
  name: string;
  yaw: number;
  /** Casas decimais que o campo de sensibilidade do jogo aceita. */
  digits: number;
  /** Onde fica a sensibilidade no jogo. */
  where: string;
}

export const SENS_GAMES: SensGame[] = [
  { id: "valorant", name: "Valorant", yaw: 0.07, digits: 3, where: "Configurações › Geral › Mouse › Sensibilidade: mira" },
  { id: "cs2", name: "Counter-Strike 2", yaw: 0.022, digits: 3, where: "Configurações › Teclado/mouse › Sensibilidade do mouse" },
  { id: "apex", name: "Apex Legends", yaw: 0.022, digits: 2, where: "Configurações › Mouse/controle › Sensibilidade do mouse" },
  { id: "overwatch", name: "Overwatch 2", yaw: 0.0066, digits: 2, where: "Opções › Controles › Geral › Sensibilidade" },
];

export const gameOf = (id: string) => SENS_GAMES.find((g) => g.id === id) ?? SENS_GAMES[0];
const game = gameOf;

/** Sensibilidade do Valorant convertida para o jogo, com as casas que o jogo aceita. */
export function sensForGame(valorantSens: number, gameId: string): number {
  return round(convertSens(valorantSens, "valorant", gameId), gameOf(gameId).digits);
}

/** Texto do número exato, com as casas do jogo (ex.: 0.350 no Valorant). */
export const formatSens = (sens: number, gameId: string) => sens.toFixed(gameOf(gameId).digits);

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
