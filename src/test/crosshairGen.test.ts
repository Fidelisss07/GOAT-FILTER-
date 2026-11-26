import { describe, expect, it } from "vitest";
import { crosshairRects, parseCrosshair } from "../lib/crosshair";
import { generateCrosshairs, XH_COLORS } from "../lib/crosshairGen";
import { isCrosshairCode } from "../lib/types";

describe("miras geradas", () => {
  const list = generateCrosshairs();

  it("passa de 1500 miras, todas com código único e válido", () => {
    expect(list.length).toBeGreaterThan(1500);
    expect(new Set(list.map((p) => p.code)).size).toBe(list.length);
    for (const p of list) {
      expect(isCrosshairCode(p.code), p.code).toBe(true);
      expect(crosshairRects(parseCrosshair(p.code)).length, p.code).toBeGreaterThan(0);
    }
  });

  it("cores do jogo e cores próprias saem no código certo", () => {
    const red = list.find((p) => p.color === "vermelha" && p.family === "ponto")!;
    expect(red.code).toContain("c;7;");
    expect(parseCrosshair(red.code).color).toBe("#ff0000");
    const orange = list.find((p) => p.color === "laranja")!;
    expect(orange.code).toContain("c;8;u;FF8C00FF;");
    expect(parseCrosshair(orange.code).color).toBe("#FF8C00");
    expect(XH_COLORS).toHaveLength(16);
  });

  it("ponto não desenha linhas e linha horizontal não tem vertical", () => {
    const dot = parseCrosshair(list.find((p) => p.family === "ponto")!.code);
    expect(dot.dot).toBe(true);
    expect(dot.inner.show).toBe(false);
    expect(dot.outer.show).toBe(false);
    const h = parseCrosshair(list.find((p) => p.family === "horizontal")!.code);
    expect(h.inner.vertical).toBe(0);
  });
});

describe("miras de pros e de sites", () => {
  it("todas as prontas têm código válido e sem repetição", async () => {
    const { CROSSHAIR_PRESETS } = await import("../lib/crosshair");
    expect(CROSSHAIR_PRESETS.length).toBeGreaterThan(35);
    expect(new Set(CROSSHAIR_PRESETS.map((p) => p.code)).size).toBe(CROSSHAIR_PRESETS.length);
    for (const p of CROSSHAIR_PRESETS) expect(isCrosshairCode(p.code), p.name).toBe(true);
  });
});
