// Robô que joga o teste "Descobrir minha sensibilidade" no modo de desenvolvimento
// (npx vite --port 5179) com uma sensibilidade "ideal" conhecida, para conferir
// se o resultado chega perto dela. Uso: node scripts/sens-bot.cjs IDEAL INICIAL
const { chromium } = require("playwright");
const [ideal, start] = process.argv.slice(2).map(Number);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.addInitScript(([start]) => {
    localStorage.setItem("goat-filter:settings", JSON.stringify({ onboarded: true, language: "pt" }));
    localStorage.setItem("goat-filter:sens", JSON.stringify({ dpi: 800, sens: start, scoped: 1, history: [] }));
    Object.defineProperty(Document.prototype, "pointerLockElement", { get() { return document.querySelector(".finder-canvas"); } });
    HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.resolve(); };
    document.exitPointerLock = () => {};
  }, [start]);
  await p.goto("http://localhost:5179/");
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "Sensibilidade" }).click();
  await p.getByRole("button", { name: "Começar", exact: true }).click();
  // Robô: mão calibrada para a sensibilidade "ideal"; ruído motor e velocidade máxima.
  await p.evaluate((ideal) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    let lastTarget = null, seenAt = 0, plan = null, lastY = 0, lastP = 0;
    setInterval(() => {
      const ref = window.__finderSim; const s = ref && ref.current;
      if (!s || !s.target) { lastTarget = null; return; }
      const now = performance.now();
      if (s.target !== lastTarget) { lastTarget = s.target; seenAt = now; plan = null; }
      if (now - seenAt < 170) return; // reação
      const moved = Math.hypot(s.yaw - lastY, s.pitch - lastP);
      lastY = s.yaw; lastP = s.pitch;
      const ey = s.target.yaw - s.yaw, ep = s.target.pitch - s.pitch;
      const err = Math.hypot(ey, ep);
      const fire = (mx, my) => document.dispatchEvent(new MouseEvent("mousemove", { movementX: Math.round(mx), movementY: Math.round(my), bubbles: true }));
      if (err < s.target.size * 3) fire(gauss() * 5, gauss() * 5);
      if (err < s.target.size * 0.7 && moved < 0.25) {
        document.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
        return;
      }
      // Planejamento em contagens pela sensibilidade "ideal" do robô.
      if (!plan) {
        const k = 1 / (ideal * 0.07);
        plan = { cx: ey * k * (1 + gauss() * 0.08), cy: -ep * k * (1 + gauss() * 0.08), done: 0 };
      }
      const total = Math.hypot(plan.cx, plan.cy);
      const maxStep = 320; // contagens por tique de 8 ms (~32 mil/s)
      const step = Math.min(maxStep, Math.max(2, total * 0.22));
      const f = Math.min(1, step / Math.max(1, total));
      const mx = plan.cx * f * (1 + gauss() * 0.05) + gauss() * 2.5, my = plan.cy * f * (1 + gauss() * 0.05) + gauss() * 2.5;
      plan.cx -= plan.cx * f; plan.cy -= plan.cy * f;
      fire(mx, my);
      if (Math.hypot(plan.cx, plan.cy) < 1.5) plan = null; // replaneja (correção)
    }, 8);
  }, ideal);
  for (let i = 0; i < 40; i++) {
    const ready = p.getByRole("button", { name: /Começar teste [AB]/ });
    const ask = p.getByRole("button", { name: "Não sei, decide pela medida" });
    if (await p.locator(".finder-big").count()) break;
    if (await ready.count()) await ready.click();
    else if (await ask.count()) await ask.click();
    await p.waitForTimeout(400);
  }
  for (let i = 0; i < 600 && !(await p.locator(".finder-big").count()); i++) {
    const ask = p.getByRole("button", { name: "Não sei, decide pela medida" });
    const ready = p.getByRole("button", { name: /Começar teste [AB]/ });
    if (await ready.count()) await ready.click();
    else if (await ask.count()) await ask.click();
    await p.waitForTimeout(300);
  }
  const res = await p.locator(".finder-big").textContent().catch(() => "sem resultado");
  const note = await p.locator(".finder-overlay .note").textContent().catch(() => "");
  const log = await p.evaluate(() => (window.__finderResult ? window.__finderResult.rounds.map((r) => `${r.a.toFixed(3)}:${r.sa.score.toFixed(0)}/${r.sa.overshootRate.toFixed(1)}/${r.sa.correctionRate.toFixed(1)} vs ${r.b.toFixed(3)}:${r.sb.score.toFixed(0)}/${r.sb.overshootRate.toFixed(1)}/${r.sb.correctionRate.toFixed(1)}`).join(" | ") : ""));
  console.log(`ideal ${ideal} start ${start} -> ${res} | ${note}\n  ${log}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
