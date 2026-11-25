const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto("file://" + __dirname + "/versus.html");
  await p.evaluate(() => window.ready);
  await p.waitForTimeout(400);
  await p.screenshot({ path: __dirname + "/versus.png" });
  await b.close();
})();
