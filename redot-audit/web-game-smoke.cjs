// Start a real minimal game in the RC2 Web engine and try its canvas capture.
// This does not exercise the editor's Play button or a user's project.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const {PNG} = require('pngjs');
const assert = require('node:assert/strict');
const secret = 'test-only-secret-012345678901234567890123456789';
const editorDir = path.resolve(process.argv[2]);
const htmlPath = path.join(editorDir, 'audit-game.html');
const project = `config_version=5\n[application]\nconfig/name="Web Game Audit"\nrun/main_scene="res://audit.tscn"\n[display]\nwindow/size/viewport_width=320\nwindow/size/viewport_height=240\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`;
const scene = `[gd_scene format=3]\n[node name="Game" type="ColorRect"]\noffset_right = 320.0\noffset_bottom = 240.0\ncolor = Color(0.95, 0.05, 0.08, 1)\n`;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="game-canvas" width="320" height="240" tabindex="0"></canvas><script src="godot.editor.js"></script><script>
(async () => { try {
  const canvas = document.getElementById('game-canvas');
  const engine = new Engine({canvas, unloadAfterInit: false, emscriptenPoolSize: 12, godotPoolSize: 4});
  await engine.init('godot.editor');
  const encode = text => new TextEncoder().encode(text);
  engine.copyToFS('/tmp/project.godot', encode(${JSON.stringify(project)}));
  engine.copyToFS('/tmp/audit.tscn', encode(${JSON.stringify(scene)}));
  await engine.start({args: ['--path', '/tmp', '--rendering-driver', 'opengl3']});
  window.__auditGameStarted = true;
} catch (e) { window.__auditGameError = String(e && e.stack || e); } })();
</script><script src="/capture.js"></script><script src="/redot-overlay.js"></script></body></html>`;
fs.writeFileSync(htmlPath, html);
const server = spawn('python3', ['redot-bridge/bridge.py', 'serve', '--editor-dir', editorDir], {env: {...process.env, REDOT_BRIDGE_TOKEN: secret}, stdio: ['ignore', 'pipe', 'pipe']});
let serverOutput = '';
server.stderr.on('data', data => {serverOutput += data.toString();});
function redPixels(bytes) {
  const png = PNG.sync.read(bytes); let count = 0;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 140 && png.data[i+1] < 100 && png.data[i+2] < 100) count++;
  return count;
}
async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:8765/native.html')).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Bridge did not start: ' + serverOutput);
}
(async () => {
  let browser; const issues = [];
  try {
    await waitServer();
    browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    page.on('pageerror', err => issues.push(String(err)));
    page.on('console', msg => {if (msg.type() === 'error') issues.push(msg.text());});
    await page.goto('http://127.0.0.1:8765/editor/audit-game.html', {waitUntil: 'load', timeout: 30000});
    await page.waitForFunction(() => window.__auditGameStarted || window.__auditGameError, null, {timeout: 120000});
    const startupError = await page.evaluate(() => window.__auditGameError || '');
    if (startupError) throw new Error(startupError);
    let displayedRed = 0;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      displayedRed = redPixels(await page.locator('#game-canvas').screenshot());
      if (displayedRed > 1000) break;
    }
    assert.ok(displayedRed > 1000, `Game did not render expected scene: ${displayedRed} red pixels`);
    await page.locator('input[type=password]').fill(secret);
    await page.getByRole('button', {name: 'Включить кадры игры'}).click();
    let frame;
    for (let i = 0; i < 20; i++) {
      const response = await fetch('http://127.0.0.1:8765/api/frame', {headers: {Authorization: `Bearer ${secret}`}});
      if (response.ok) {
        assert.equal(response.headers.get('X-Redot-Source'), 'web-game');
        frame = Buffer.from(await response.arrayBuffer()); break;
      }
      await page.waitForTimeout(1000);
    }
    assert.ok(frame, 'No frame uploaded');
    const capturedRed = redPixels(frame);
    assert.ok(capturedRed > 1000, `Uploaded game frame is blank or incorrect (${capturedRed} red pixels; displayed ${displayedRed})`);
    const message = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'game_screenshot'}}) + '\n';
    const mcp = spawnSync('python3', ['redot-bridge/bridge.py', 'mcp'], {input: message, encoding: 'utf8', env: {...process.env, REDOT_BRIDGE_TOKEN: secret}, timeout: 10000});
    assert.equal(mcp.status, 0, mcp.stderr);
    const result = JSON.parse(mcp.stdout).result;
    assert.ok(!result.isError, JSON.stringify(result));
    assert.ok(redPixels(Buffer.from(result.content[0].data, 'base64')) > 1000, 'MCP image is not the game scene');
    await page.getByRole('button', {name: 'Остановить кадры'}).click();
    await page.waitForTimeout(500);
    const deletion = JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'delete_game_screenshot'}}) + '\n';
    const deleted = spawnSync('python3', ['redot-bridge/bridge.py', 'mcp'], {input: deletion, encoding: 'utf8', env: {...process.env, REDOT_BRIDGE_TOKEN: secret}, timeout: 10000});
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.ok(!JSON.parse(deleted.stdout).result.isError, deleted.stdout);
    assert.equal((await fetch('http://127.0.0.1:8765/api/frame', {headers: {Authorization: `Bearer ${secret}`}})).status, 404, 'deleted frame is still present');
    console.log('::notice title=Web game capture smoke::Minimal RC2 Web game rendered; its scene reached MCP and was deleted after capture stopped. Editor Play and Android are not tested.');
  } catch (err) {
    const text = `${err.stack || err}\nBrowser errors: ${issues.slice(-8).join(' | ')}`.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=Web game capture smoke::${text}`); process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    fs.unlinkSync(htmlPath);
  }
})();
