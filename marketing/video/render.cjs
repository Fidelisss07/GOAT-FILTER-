// Renderiza o vídeo quadro a quadro: node render.cjs [--preview t1,t2,...]
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const FPS = 30;
const OUT = path.join(ROOT, "out");
const FRAMES = path.join(OUT, "frames");

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto(`http://localhost:${port}/index.html`);
  await p.evaluate(() => window.ready);
  const prevArg = process.argv.indexOf("--preview");
  if (prevArg > 0) {
    const times = process.argv[prevArg + 1].split(",").map(Number);
    fs.mkdirSync(path.join(OUT, "preview"), { recursive: true });
    for (const t of times) {
      await p.evaluate((t) => window.seek(t), t);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await p.screenshot({ path: path.join(OUT, "preview", `t${t}.jpg`), type: "jpeg", quality: 80 });
    }
  } else {
    fs.rmSync(FRAMES, { recursive: true, force: true });
    fs.mkdirSync(FRAMES, { recursive: true });
    const dur = await p.evaluate(() => window.DURATION);
    const n = Math.round(dur * FPS);
    for (let f = 0; f < n; f++) {
      await p.evaluate(([t, f]) => window.seek(t, f), [f / FPS, f]);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await p.screenshot({ path: path.join(FRAMES, `${String(f + 1).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
      if (f % 60 === 0) console.log(`quadro ${f}/${n}`);
    }
  }
  await b.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
