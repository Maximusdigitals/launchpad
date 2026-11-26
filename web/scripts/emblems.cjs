const pw = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 320 } });
  await p.goto('file://' + __dirname + '/emblems.html');
  await p.waitForTimeout(800);
  for (let i = 0; i < 6; i++) await (await p.$('#t' + i)).screenshot({ path: `/tmp/emb${i}.png` });
  await b.close();
})();
