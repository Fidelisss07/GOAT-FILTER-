const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
  for (const s of ["1","2"]) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await p.goto("file://" + __dirname + "/slide.html?slide=" + s);
    await p.evaluate(() => window.ready);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${__dirname}/slide-${s}.png` });
    await p.close();
  }
  await b.close();
})();
