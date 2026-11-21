// Browser integration with an isolated fake dashboard; no production URLs.
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const token = 'local-test-only-' + 'x'.repeat(40);
const server = http.createServer((req, res) => {
  if (req.url === '/data') { res.writeHead(200, {'content-type':'text/plain'}); res.end('dashboard-ok'); return; }
  if (!req.url.startsWith('/dashboard')) { res.writeHead(404); res.end(); return; }
  server.requests++;
  res.writeHead(200, {'content-type':'text/html', 'cache-control':'no-store'});
  res.end(`<!doctype html><h1>Fake dashboard</h1><script>
  fetch('/data').then(r=>r.text()).then(text=>{window.selfFetch=text;});
  try { parent.document.getElementById('game').contentDocument.querySelector('#token').value; window.parentBlocked=false; }
  catch (_) { window.parentBlocked=true; }
  </script>`);
});
server.requests = 0;
const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
async function freePort() {
  const s = net.createServer(); await listen(s); const port=s.address().port; await close(s); return port;
}
(async () => {
  let bridge, browser;
  try {
    await listen(server);
    const port=await freePort();
    bridge=spawn('python3',['redot-bridge/bridge.py','serve','--port',String(port)], {env:{...process.env, REDOT_BRIDGE_TOKEN:token}, stdio:['ignore','ignore','pipe']});
    let stderr=''; bridge.stderr.on('data', chunk => stderr += chunk);
    for (let i=0;i<100;i++) {
      if (bridge.exitCode !== null) throw new Error('Bridge exited: '+stderr);
      try { if ((await fetch(`http://127.0.0.1:${port}/workspace.html`)).ok) break; } catch (_) {}
      if (i===99) throw new Error('Bridge did not start: '+stderr);
      await new Promise(resolve => setTimeout(resolve,100));
    }
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1400,height:900}});
    await page.goto(`http://127.0.0.1:${port}/workspace.html`);
    await page.frameLocator('#game').locator('#token').fill(token);
    assert.equal(server.requests,0,'dashboard must not load before user action');
    await page.locator('#dashboard-url').fill(`http://127.0.0.1:${server.address().port}/dashboard.html?view=1`);
    await page.locator('#load-dashboard').click();
    await page.frameLocator('#dashboard').getByRole('heading',{name:'Fake dashboard'}).waitFor();
    const frame=page.frames().find(f=>f.url().includes('/dashboard.html?view=1'));
    assert.ok(frame, 'dashboard frame failed to load');
    await frame.waitForFunction(() => window.selfFetch === 'dashboard-ok');
    assert.equal(await frame.evaluate(() => window.parentBlocked),true,'dashboard must not read viewer secret');
    assert.equal(await page.locator('#dashboard-url').inputValue(),'');
    assert.equal(server.requests,1);
    await page.locator('#close-dashboard').click();
    await page.waitForFunction(() => document.getElementById('dashboard').getAttribute('src') === 'about:blank');
    assert.equal(await page.locator('#open-dashboard').isDisabled(),true);
    assert.equal(await page.frameLocator('#game').locator('#token').inputValue(),token,'closing dashboard must not disconnect viewer');
    console.log('::notice title=Workspace browser test::Opt-in dashboard loaded in isolated iframe, could fetch its own files but could not read viewer secret; disconnect left viewer intact.');
  } catch (error) {
    console.error(error.stack || error); process.exitCode=1;
    console.log('::error title=Workspace browser test::'+String(error.stack || error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
  } finally {
    if (browser) await browser.close();
    if (bridge) bridge.kill();
    await close(server);
  }
})();
