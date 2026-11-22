// Browser integration with an isolated fake dashboard; no production URLs.
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const token = 'local-test-only-' + 'x'.repeat(40);
const uploads = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/s/test/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'PUT') {
      const chunks = []; req.on('data', c=>chunks.push(c)); req.on('end',()=>{
        uploads.push({name: new URL(req.url, 'http://fake').searchParams.get('name'), headers:req.headers, data:Buffer.concat(chunks)});
        res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}');
      }); return;
    }
  }
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
    // Upload a synthetic game frame to the local bridge, then explicitly share
    // it through the real viewer to the isolated fake WebFTP with CORS.
    const image = await page.evaluate(() => {
      const c=document.createElement('canvas'); c.width=2; c.height=2;
      const ctx=c.getContext('2d'); ctx.fillStyle='red'; ctx.fillRect(0,0,2,2);
      return c.toDataURL('image/png').split(',')[1];
    });
    const sent = await fetch(`http://127.0.0.1:${port}/api/frame`, {method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/png','X-Redot-Source':'native-game'}, body:Buffer.from(image,'base64')});
    assert.equal(sent.status,204);
    const viewer = page.frameLocator('#game');
    await viewer.locator('#connect').click();
    await viewer.locator('#status').filter({hasText:'native-game'}).waitFor({timeout:10000});
    await viewer.locator('#share-url').fill(`http://127.0.0.1:${server.address().port}/s/test`);
    assert.equal(uploads.length,0,'share must be opt-in');
    await viewer.locator('#share-consent').check();
    await viewer.locator('#share-frame').click();
    await viewer.locator('#share-status').filter({hasText:'Отправлены'}).waitFor({timeout:10000});
    assert.equal(uploads.length,2);
    assert.match(uploads[0].name,/^screenshot-live-[0-9a-f]{32}\.png$/);
    assert.ok(uploads[0].data.equals(Buffer.from(image,'base64')));
    assert.equal(uploads[0].headers.authorization,undefined,'bridge secret must never reach WebFTP');
    assert.match(uploads[1].name,/^chat-\d{14}-[0-9a-f]{12}\.json$/);
    const notice=JSON.parse(uploads[1].data.toString('utf8'));
    assert.ok(notice.text.includes(uploads[0].name));
    assert.ok(!notice.text.includes('/s/test'),'notice must not disclose the share URL');
    await page.locator('#close-dashboard').click();
    await page.waitForFunction(() => document.getElementById('dashboard').getAttribute('src') === 'about:blank');
    assert.equal(await page.locator('#open-dashboard').isDisabled(),true);
    assert.equal(await page.frameLocator('#game').locator('#connect').textContent(),'Отключить','closing dashboard must not disconnect viewer');
    console.log('::notice title=Workspace browser test::Dashboard remained isolated; opt-in game frame and chat notice were uploaded to a fake WebFTP without the bridge secret.');
  } catch (error) {
    console.error(error.stack || error); process.exitCode=1;
    console.log('::error title=Workspace browser test::'+String(error.stack || error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
  } finally {
    if (browser) await browser.close();
    if (bridge) bridge.kill();
    await close(server);
  }
})();
