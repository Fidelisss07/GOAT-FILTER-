import { describe, expect, it } from "vitest";
import {
  angularDistance,
  Approach,
  balanceAdjust,
  band,
  makeTargets,
  nextCenter,
  roundPair,
  scoreTest,
  TargetResult,
} from "../lib/sensFinder";
import { formatMult, formatSens, sensForGame } from "../lib/sens";

const hit = (ms: number, extra: Partial<TargetResult> = {}): TargetResult => ({
  ms, angle: 30, size: 1.4, overshoot: false, corrections: 0, misses: 0, ...extra,
});

describe("descobrir a sensibilidade", () => {
  it("nota menor para quem acerta mais rápido e sem errar", () => {
    const fast = scoreTest([hit(400), hit(420), hit(380)]);
    const slow = scoreTest([hit(700), hit(650), hit(720)]);
    const sloppy = scoreTest([hit(400, { misses: 3 }), hit(420, { misses: 2 }), hit(380, { misses: 2 })]);
    expect(fast.score).toBeLessThan(slow.score);
    expect(fast.score).toBeLessThan(sloppy.score);
  });

  it("rodadas estreitam a faixa ao redor da atual", () => {
    const [a, b] = roundPair(0.4, 0, false);
    expect(a).toBeCloseTo(0.2);
    expect(b).toBeCloseTo(0.6);
    const [c, d] = roundPair(0.4, 4, true);
    expect(c).toBeGreaterThan(d);
    expect(c / 0.4).toBeCloseTo(1.07);
  });

  it("vence a medida quando a diferença é clara; senão vale o que a pessoa sentiu", () => {
    const good = scoreTest([hit(400), hit(400)]);
    const bad = scoreTest([hit(600), hit(600)]);
    // A (0.3) foi muito melhor (50%): vai até ela.
    expect(nextCenter(0.4, 0.3, 0.5, good, bad, "b")).toBeCloseTo(0.3);
    // Melhor por pouco mais que o ruído (10%): anda 2/3 do caminho.
    const ok = scoreTest([hit(440), hit(440)]);
    expect(nextCenter(0.4, 0.3, 0.5, good, ok, null)).toBeCloseTo(0.3333);
    // Empate na medida: segue a preferência.
    expect(nextCenter(0.4, 0.3, 0.5, good, good, "b")).toBeCloseTo(0.4667);
    expect(nextCenter(0.4, 0.3, 0.5, good, good, "same")).toBeCloseTo(0.4);
  });

  it("ajuste final pelo jeito de errar", () => {
    const over = Array.from({ length: 10 }, () => hit(500, { overshoot: true }));
    const under = Array.from({ length: 10 }, () => hit(500, { corrections: 2 }));
    expect(balanceAdjust(0.4, over).sens).toBeLessThan(0.4);
    expect(balanceAdjust(0.4, under).sens).toBeGreaterThan(0.4);
    expect(balanceAdjust(0.4, [hit(500), hit(500)]).reason).toBe("balanced");
  });

  it("os dois testes da rodada recebem os mesmos alvos, sempre na tela", () => {
    const x = makeTargets(42);
    expect(makeTargets(42)).toEqual(x);
    expect(x).toHaveLength(10);
    for (const t of x) expect(Math.abs(t.dyaw)).toBeLessThanOrEqual(45);
  });

  it("detecta quando passa do alvo e quando para antes", () => {
    const a = new Approach(0, 0, 30, 0, 1.4);
    a.update(15, 0, 200, 0);
    a.update(34, 0, 200, 16);
    expect(a.overshoot).toBe(true);
    const b = new Approach(0, 0, 30, 0, 1.4);
    b.update(10, 0, 300, 0);
    b.update(20, 0, 2, 20);
    b.update(20, 0, 2, 120);
    expect(b.corrections).toBe(1);
    expect(b.overshoot).toBe(false);
  });

  it("resultado no número exato de cada jogo", () => {
    expect(formatSens(sensForGame(0.3456, "valorant"), "valorant")).toBe("0.346");
    expect(formatSens(sensForGame(0.35, "cs2"), "cs2")).toBe("1.114");
    expect(formatSens(sensForGame(0.35, "overwatch"), "overwatch")).toBe("3.71");
    expect(formatSens(sensForGame(0.35, "apex"), "apex")).toBe("1.11");
    // Valorant em português mostra com vírgula.
    expect(formatSens(0.2, "valorant", true)).toBe("0,2");
    expect(formatMult(0.726, true)).toBe("0,726");
    expect(formatMult(1, true)).toBe("1");
  });

  it("geometria e faixas", () => {
    expect(angularDistance(0, 0, 90, 0)).toBeCloseTo(90);
    expect(band(280)).toBe("média");
    expect(band(120)).toBe("muito baixa");
    expect(band(700)).toBe("muito alta");
  });
});
