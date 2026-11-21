// Real-browser smoke test of the built Web editor and bridge-injected shell.
// Requires playwright and pngjs. No user projects or credentials are used.
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const secret = 'test-only-secret-012345678901234567890123456789';
const editor = path.resolve(process.argv[2]);
const server = spawn('python3', ['redot-bridge/bridge.py', 'serve', '--editor-dir', editor], {
  env: { ...process.env, REDOT_BRIDGE_TOKEN: secret }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stderr.on('data', data => { serverOutput += data.toString(); });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch('http://127.0.0.1:8765/native.html'); if (response.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local bridge failed to start: ' + serverOutput);
}

(async () => {
  let browser;
  const issues = [];
  try {
    await waitForServer();
    browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    page.on('pageerror', err => issues.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') issues.push(msg.text()); });
    const response = await page.goto('http://127.0.0.1:8765/editor/godot.editor.html', {waitUntil: 'load', timeout: 30000});
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cross-origin-opener-policy'], 'same-origin');
    assert.equal(response.headers()['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(await page.evaluate(() => window.crossOriginIsolated), true);
    assert.equal(await page.locator('text=Мост: кадры игры').count(), 1);
    const wasm = await page.request.get('http://127.0.0.1:8765/editor/godot.editor.wasm');
    assert.equal(wasm.status(), 200);
    assert.match(wasm.headers()['content-type'], /application\/wasm/);
    await page.locator('#welcome-modal-dismiss').click();
    await page.locator('#startButton').click();
    await page.waitForFunction(() => {
      const notice = document.querySelector('#status-notice');
      if (notice && notice.style.display !== 'none' && notice.textContent.trim()) throw new Error(notice.textContent.trim());
      const tab = document.querySelector('#tab-editor');
      return tab && getComputedStyle(tab).display !== 'none';
    }, null, {timeout: 120000});
    // The tab can become visible before rendering. Wait until its screenshot has
    // a variety of colors, which detects blank/failed canvas but is not a game test.
    let colors = 0;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const screenshot = await page.locator('#editor-canvas').screenshot({timeout: 15000});
      const png = PNG.sync.read(screenshot);
      const unique = new Set();
      for (let p = 0; p < png.data.length; p += 64) unique.add(`${png.data[p] >> 4},${png.data[p+1] >> 4},${png.data[p+2] >> 4}`);
      colors = unique.size;
      if (colors >= 12) break;
    }
    assert.ok(colors >= 12, `Editor canvas appears blank (${colors} color buckets). Console: ${issues.slice(-5).join(' | ')}`);
    console.log(`::notice title=Web editor browser smoke::RC2 project manager rendered in Chromium software WebGL (${colors} color buckets), COOP/COEP and bridge overlay present. Play, capture, plugins and real GPU not tested.`);
  } catch (err) {
    const text = `${err.stack || err}\nBrowser errors: ${issues.slice(-8).join(' | ')}`.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=Web editor browser smoke::${text}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})();
