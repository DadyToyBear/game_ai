// Connect the real browser viewer to a running native editor and test its UI.
const {chromium} = require('playwright');
const {PNG} = require('pngjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    assert.match(await page.locator('#status').textContent(), /получен мостом/);
    // Record the actual game viewport shown by the browser, not the editor UI.
    await page.locator('#record').click();
    await page.waitForTimeout(3000);
    const [download] = await Promise.all([page.waitForEvent('download', {timeout: 30000}), page.locator('#record').click()]);
    const videoBytes = fs.readFileSync(await download.path());
    assert.ok(videoBytes.length > 128 && videoBytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'Recording is not a nonempty WebM');
    const recordedRed = await page.evaluate(async bytes => {
      const video = document.createElement('video'); video.muted = true;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'video/webm'}));
      try {
        video.src = url;
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(Error('WebM decode failed')); });
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d'); let maximum = 0;
        await video.play();
        for (let attempt=0; attempt<30; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          ctx.drawImage(video, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0;
          for (let i=0; i<data.length; i+=4) if(data[i]>140 && data[i+1]<100 && data[i+2]<100) count++;
          maximum = Math.max(maximum, count);
          if (maximum > 1000 || video.ended) break;
        }
        return maximum;
      } finally { URL.revokeObjectURL(url); }
    }, Array.from(videoBytes));
    assert.ok(recordedRed > 1000, `Recorded WebM does not contain the red game scene (${recordedRed} pixels)`);
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('игра остановлена'), null, {timeout: 60000});
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('возможно устарел'), null, {timeout: 20000});
    await page.locator('#delete').click();
    await page.waitForTimeout(500);
    const response = await fetch('http://127.0.0.1:8765/api/frame', {headers: {'Authorization': `Bearer ${secret}`}});
    assert.equal(response.status, 404, 'frame remains after browser deletion');
    console.log(`Browser Play, viewing (${pixels} red pixels), Stop and delete succeeded.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
