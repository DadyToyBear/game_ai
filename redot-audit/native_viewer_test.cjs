// Connect the real browser viewer to a running native editor and test its UI.
const {chromium} = require('playwright');
const {PNG} = require('pngjs');
const assert = require('node:assert/strict');
const secret = process.env.REDOT_BRIDGE_TOKEN;

function redPixels(image) {
  const png = PNG.sync.read(image); let count = 0;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 140 && png.data[i+1] < 100 && png.data[i+2] < 100) count++;
  return count;
}

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 900}});
    await page.goto('http://127.0.0.1:8765/native.html', {waitUntil: 'load'});
    await page.locator('#token').fill(secret);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Редактор подключён'), null, {timeout: 30000});
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Игра запущена'), null, {timeout: 60000});
    let pixels = 0;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      pixels = redPixels(await page.locator('#screen').screenshot());
      if (pixels > 1000) break;
    }
    assert.ok(pixels > 1000, `Viewer did not display the red game scene (${pixels} red pixels)`);
    assert.match(await page.locator('#status').textContent(), /native-game/);
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('игра остановлена'), null, {timeout: 60000});
    await page.waitForTimeout(1000);
    await page.locator('#delete').click();
    await page.waitForTimeout(500);
    const response = await fetch('http://127.0.0.1:8765/api/frame', {headers: {'Authorization': `Bearer ${secret}`}});
    assert.equal(response.status, 404, 'frame remains after browser deletion');
    console.log(`Browser Play, viewing (${pixels} red pixels), Stop and delete succeeded.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
