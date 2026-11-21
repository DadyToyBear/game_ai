// Test the pinned dashboard copy against an isolated WebFTP simulator.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'redot-chat-'));
const output = path.join(tmp, 'dashboard-enhanced.html');
const source = fs.existsSync('multiagent-upstream/dashboard.html') ? 'multiagent-upstream/dashboard.html' : 'dashboard.html';
const result = spawnSync('python3', ['redot-bridge/prepare_dashboard.py', source, output], {encoding:'utf8'});
if (result.status !== 0) throw Error(result.stderr);
const files = {
  'chat-index.json': JSON.stringify(['task-bad.json','chat-old.json']),
  'chat-20261121123456-a.json': JSON.stringify({from:'chat-zai',text:'Привет <img src=x onerror=alert(1)>',ts:'2026-11-21T12:34:56Z'}),
  'dm-me-or-ling-20261121.json': JSON.stringify({from:'or-ling',to:'opencode-1',text:'Личное',ts:'2026-11-21T12:34:57Z'}),
  'assign-as1.json': JSON.stringify({agent:'or-ling',method:'read_script',ts:'2026-11-21T12:34:58Z'}),
  'result-zzz.json': JSON.stringify({result:'private test result'}),
  'event-zzz.json': JSON.stringify({kind:'build_completed'}),
  'agent-or-ling-heartbeat.json': JSON.stringify({agent:'or-ling',ts:new Date().toISOString(),status:'тест <img src=x onerror=alert(1)>',alive:true}),
  'agent-chat-zai-heartbeat.json': JSON.stringify({agent:'chat-zai',ts:new Date(Date.now()-6*60*1000).toISOString(),status:'',alive:true}),
  'agent-or-gemma-26-heartbeat.json': JSON.stringify({agent:'or-gemma-26',ts:new Date(Date.now()-16*60*1000).toISOString(),status:'',alive:true}),
  'agent-redot-cli-heartbeat.json': JSON.stringify({agent:'other',ts:new Date().toISOString(),status:'',alive:true}),
};
const names = [...Array.from({length:21645}, (_,i)=>'task-'+String(i).padStart(6,'0')+'.json'), ...Object.keys(files).filter(n=>n!=='chat-index.json')];
const requested = [];
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/s/abcdef/dashboard-enhanced.html') {res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(fs.readFileSync(output));return;}
  if (url.pathname === '/s/abcdef/' && url.searchParams.get('json') === '1') {
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({items:names.map(name=>({name,type:'file'}))}));return;
  }
  if (url.pathname === '/s/abcdef/') {res.writeHead(200,{'content-type':'text/html'});res.end('<html></html>');return;}
  const name=decodeURIComponent(url.pathname.split('/').pop()); requested.push(name);
  const data=files[name] || (name.startsWith('task-') ? '{"method":"example"}' : null);
  if (data) {res.writeHead(200,{'content-type':'application/json'});res.end(data);} else {res.writeHead(404);res.end();}
});
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(`${origin}/s/abcdef/dashboard-enhanced.html?view=1`);
    await page.locator('#tab-chat').click();
    await page.locator('#room-feed').getByText('Привет <img src=x onerror=alert(1)>').waitFor({timeout:15000});
    assert.equal(await page.locator('#room-feed img').count(),0,'chat text must not execute as HTML');
    assert.match(await page.locator('#room-feed').textContent(),/Назначение or-ling/);
    await page.locator('#dm-feed').getByText('Личное').waitFor({timeout:5000});
    const presence = id => page.locator(`.agent-item[data-id="${id}"] .presence`);
    await presence('or-ling').filter({hasText:'Недавний сигнал'}).waitFor({timeout:5000});
    assert.match(await presence('chat-zai').textContent(),/Сигнал устарел/);
    assert.match(await presence('or-gemma-26').textContent(),/давно не обновлялся/);
    assert.match(await presence('redot-cli').textContent(),/Нет достоверных данных/);
    assert.match(await presence('or-ling').textContent(),/<img src=x/);
    assert.equal(await page.locator('#agent-list img').count(),0,'heartbeat status must not execute as HTML');
    assert.ok(!requested.some(x=>/^(task|result|event)-/.test(x)), 'MCP traffic must not be fetched by default');
    assert.equal(await page.locator('#chat-mcp-feed').isHidden(),true);
    await page.locator('#chat-show-mcp').check();
    await page.locator('#chat-mcp-feed').getByText('private test result').waitFor({timeout:15000});
    assert.ok(requested.includes('result-zzz.json'));
    await page.locator('#chat-show-mcp').uncheck();
    assert.equal(await page.locator('#chat-mcp-feed').isHidden(),true);
    assert.equal(await page.locator('#chat-mcp-feed').textContent(),'');
    console.log('::notice title=Chat dashboard::Agent messages, DMs and assignments remain visible with 21,645 legacy files; MCP traffic requires opt-in.');
  } catch(e) { console.error(e.stack||e); process.exitCode=1; }
  finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(tmp,{recursive:true,force:true}); }
})();
