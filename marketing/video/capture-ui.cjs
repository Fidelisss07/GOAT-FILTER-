// Captura telas e sequências reais do app (modo demonstração) para o vídeo.
// Uso: (na raiz do app) npx vite preview --port 4173 & node marketing/video/capture-ui.cjs
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "assets", "ui");
fs.mkdirSync(OUT, { recursive: true });
const shot = (p, name, q = 88) => p.screenshot({ path: path.join(OUT, name + ".jpg"), type: "jpeg", quality: q });

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "pt-BR" });
  await p.goto("http://localhost:4173");
  await p.waitForTimeout(900);
  // esconde a faixa "modo demonstração"
  await p.addStyleTag({ content: ".demo-banner,[class*='demo']{visibility:hidden!important}" });

  // 1. Vibrance: arrasta de 50 até 170 (sequência)
  const slider = p.getByRole("slider", { name: "Digital Vibrance" });
  await slider.focus();
  await p.keyboard.press("Home");
  for (let i = 0; i < 10; i++) await p.keyboard.press("PageUp"); // 100
  for (let i = 0; i < 5; i++) await p.keyboard.press("PageDown"); // 50
  const div = p.getByRole("slider", { name: /Divisor/ });
  for (let f = 0; f < 36; f++) {
    await slider.focus();
    if (f > 0) for (let k = 0; k < 4; k++) await p.keyboard.press("ArrowRight"); // +4 por quadro → 190
    if (f > 4 && f < 30) { await div.focus(); await p.keyboard.press(f < 17 ? "ArrowLeft" : "ArrowRight"); }
    await shot(p, `vib-${String(f).padStart(2, "0")}`);
  }
  await p.getByRole("button", { name: "Aplicar" }).click();
  await p.waitForTimeout(250);
  await shot(p, "vib-applied");

  // 2. Perfis
  await p.getByRole("button", { name: "Perfis" }).click();
  await p.waitForTimeout(400);
  await shot(p, "profiles");

  // 3. Gravação: antes, replay ligado, clipes salvos, editor
  await p.getByRole("button", { name: "Gravação" }).click();
  await p.waitForTimeout(500);
  await shot(p, "rec-off");
  await p.locator(".row", { hasText: "Replay instantâneo" }).getByRole("switch").click();
  await p.waitForTimeout(1300);
  await shot(p, "rec-on");
  for (const n of ["Últimos 15s", "Últimos 20s", "Últimos 30s"]) { await p.getByRole("button", { name: n }).click(); await p.waitForTimeout(300); }
  await shot(p, "rec-saved");
  await p.waitForTimeout(3600);
  await p.getByRole("button", { name: "Favoritar" }).first().click();
  await p.waitForTimeout(300);
  await shot(p, "rec-list");
  await p.getByRole("button", { name: "Editar", exact: true }).first().click();
  await p.waitForTimeout(500);
  await shot(p, "rec-editor");
  await p.keyboard.press("Escape");

  // 4. Desempenho
  await p.getByRole("button", { name: "Desempenho" }).click();
  await p.waitForTimeout(900);
  await shot(p, "perf");

  // 5. Treino: mira com acertos reais (sequência)
  await p.getByRole("button", { name: "Treino" }).click();
  await p.getByRole("tab", { name: "Mira", exact: true }).click();
  await p.getByRole("button", { name: "Começar" }).click();
  for (let f = 0; f < 48; f++) {
    if (f % 6 === 5) {
      const t = p.locator(".target");
      const box = await t.boundingBox().catch(() => null);
      if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await p.waitForTimeout(40);
    await shot(p, `aim-${String(f).padStart(2, "0")}`, 82);
  }
  await p.getByRole("button", { name: "Parar" }).click();
  await p.waitForTimeout(300);
  await shot(p, "aim-result");

  // 6. Outras abas
  await p.getByRole("tab", { name: "Sensibilidade" }).click(); await p.waitForTimeout(200); await shot(p, "sens");
  await p.getByRole("tab", { name: "Miras" }).click();
  await p.getByLabel("Nome").fill("Minha mira");
  await p.getByLabel("Código da mira").fill("0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0");
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByLabel("Nome").fill("TenZ");
  await p.getByLabel("Código da mira").fill("0;s;1;P;c;5;o;1;d;1;0l;0;0o;2;0a;1;0f;0;1b;0");
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.waitForTimeout(200); await shot(p, "crosshairs");
  await p.getByRole("tab", { name: "Visibilidade" }).click(); await p.waitForTimeout(200); await shot(p, "visibility");
  await p.getByRole("tab", { name: "Evolução" }).click(); await p.waitForTimeout(200); await shot(p, "progress");
  await p.getByRole("tab", { name: "Mouse" }).click(); await p.waitForTimeout(200); await shot(p, "mouse");
  await p.getByRole("button", { name: "Configurações" }).click(); await p.waitForTimeout(300); await shot(p, "settings");
  await b.close();
  console.log(fs.readdirSync(OUT).length, "arquivos");
})().catch((e) => { console.error(e); process.exit(1); });
