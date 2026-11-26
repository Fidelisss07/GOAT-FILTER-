import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaSession,
  buildProfile,
  coach,
  dailyRoutine,
  loadSessions,
  nextLevel,
  rankOf,
  saveSession,
  sessionScore,
  sessionStats,
  Shot,
} from "../lib/aimStats";

const shot = (o: Partial<Shot> = {}): Shot => ({
  ms: 400,
  react: 230,
  angle: 20,
  size: 1.5,
  over: false,
  corr: 0,
  miss: 0,
  head: null,
  dx: 20,
  dy: 0,
  t: 0,
  ...o,
});

const sess = (mode: ArenaSession["mode"], shots: Shot[], extra: Partial<ArenaSession> = {}): ArenaSession => ({
  id: Math.random().toString(36),
  mode,
  at: Date.now(),
  dur: 30_000,
  level: 2,
  sens: 0.35,
  shots,
  score: 0,
  ...extra,
});

describe("estatística da arena", () => {
  beforeEach(() => localStorage.clear());

  it("calcula precisão, cabeça, passou do alvo e lado mais lento", () => {
    const shots = [
      ...Array.from({ length: 6 }, (_, i) => shot({ dx: -20, ms: 600, over: i < 4, t: i * 100 })),
      ...Array.from({ length: 6 }, (_, i) => shot({ dx: 20, ms: 350, t: 600 + i * 100 })),
      shot({ timeout: true, miss: 2 }),
    ];
    const st = sessionStats({ shots });
    expect(st.kills).toBe(12);
    expect(st.accuracy).toBeCloseTo(12 / 15);
    expect(st.overRate).toBeCloseTo(4 / 12);
    expect(st.dir.left!).toBeGreaterThan(st.dir.right!);
  });

  it("perfil, elo e dicas: mira baixa, lado esquerdo e passar do alvo", () => {
    const flick = sess(
      "flick",
      [
        ...Array.from({ length: 8 }, () => shot({ dx: -25, ms: 700, over: true })),
        ...Array.from({ length: 8 }, () => shot({ dx: 25, ms: 380, over: true })),
      ],
    );
    const peek = sess(
      "peek",
      Array.from({ length: 10 }, (_, i) => shot({ head: i < 3, place: 4, pitchErr: -2.5, react: 360 })),
    );
    const p = buildProfile([flick, peek]);
    expect(p.overall).not.toBeNull();
    expect(p.skills.placement).not.toBeNull();
    expect(p.skills.tracking).toBeNull();
    const ids = coach(p).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["over", "low", "body", "side", "react"]));
    // A dica de passar do alvo manda testar a sensibilidade.
    expect(coach(p).find((i) => i.id === "over")?.sens).toBe(true);
  });

  it("elo por faixas, com Radiante no topo", () => {
    expect(rankOf(0)).toMatchObject({ name: "Ferro", div: 1 });
    expect(rankOf(40)).toMatchObject({ name: "Ouro", div: 2 });
    expect(rankOf(97)).toMatchObject({ name: "Radiante", div: null });
  });

  it("rotina do dia foca nas habilidades mais fracas", () => {
    const p = buildProfile([sess("tracking", [], { track: { onHead: 0.1, onBody: 0.3, lag: 1.5, offset: 3 } })]);
    const r = dailyRoutine(p);
    expect(r[0].mode).toBe("flick");
    expect(r[r.length - 1].mode).toBe("peek");
    expect(r.length).toBeGreaterThanOrEqual(4);
  });

  it("dificuldade sobe quando acerta muito e desce quando erra muito", () => {
    const good = sess("flick", Array.from({ length: 20 }, () => shot()));
    const bad = sess("flick", Array.from({ length: 10 }, () => shot({ miss: 3 })));
    expect(nextLevel(3, good)).toBe(4);
    expect(nextLevel(3, bad)).toBe(2);
    expect(nextLevel(10, good)).toBe(10);
  });

  it("salva no PC e pontua cabeça acima de corpo", () => {
    const head = sess("peek", [shot({ head: true })]);
    const body = sess("peek", [shot({ head: false })]);
    expect(sessionScore(head)).toBeGreaterThan(sessionScore(body));
    saveSession({ ...head, score: sessionScore(head) });
    expect(loadSessions()).toHaveLength(1);
  });
});

describe("mapa e skins", () => {
  it("o mapa entra no perfil de posição da mira e dura até 90 s", async () => {
    const { modeDuration, MODE_SKILL, dailyRoutine: routine } = await import("../lib/aimStats");
    expect(modeDuration("preaim")).toBe(90_000);
    expect(MODE_SKILL.preaim).toBe("placement");
    expect(routine(buildProfile([])).length).toBeGreaterThanOrEqual(3);
  });

  it("13 skins próprias com ids únicos", async () => {
    const { WEAPON_SKINS, skinById } = await import("../lib/weaponSkins");
    expect(WEAPON_SKINS).toHaveLength(13);
    expect(new Set(WEAPON_SKINS.map((s) => s.id)).size).toBe(13);
    expect(WEAPON_SKINS[0]).toMatchObject({ id: "draconica", special: "dragon" });
    expect(skinById("nao-existe").id).toBe("padrao");
  });
});
