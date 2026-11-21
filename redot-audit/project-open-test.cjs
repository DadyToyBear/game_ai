// Browser integration of folder and HTTPS ZIP preparation; real editor shell.
const {chromium} = require('playwright');
const {spawn, spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const editor = path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'redot-folder-'));
const folder = path.join(temp, 'Project'); fs.mkdirSync(path.join(folder, '.git'), {recursive:true}); fs.mkdirSync(path.join(folder, '.godot'));
fs.writeFileSync(path.join(folder, 'project.godot'), 'config_version=5\n');
fs.writeFileSync(path.join(folder, 'игра.gd'), 'extends Node\n');
fs.writeFileSync(path.join(folder, '.git', 'secret'), 'excluded'); fs.writeFileSync(path.join(folder, '.godot', 'cache'), 'excluded');
const server = spawn('python3', ['redot-bridge/bridge.py','serve','--editor-dir',editor], {env:{...process.env,REDOT_BRIDGE_TOKEN:'test-only-secret-012345678901234567890123456789'},stdio:'ignore'});
async function waitServer() {for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8765/project-open.html')).ok)return;}catch(_){} await new Promise(r=>setTimeout(r,100));} throw Error('Bridge did not start');}
(async () => { let browser, cloud;
  try {
    await waitServer(); browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({acceptDownloads:true, ignoreHTTPSErrors:true}); const errors=[], diagnostics=[]; page.on('pageerror', e=>errors.push(String(e))); page.on('console', m=>{if(m.type()==='error') diagnostics.push(m.text());}); page.on('requestfailed', req=>diagnostics.push(`${req.url()}: ${req.failure()?.errorText}`));
    await page.goto('http://127.0.0.1:8765/editor/godot.editor.html');
    await page.locator('#welcome-modal-dismiss').click();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout:30000});
    await page.locator('#redot-folder').setInputFiles(folder);
    await page.waitForFunction(() => document.querySelector('#zip-file').files.length === 1);
    const zipBytes = await page.locator('#zip-file').evaluate(async el => Array.from(new Uint8Array(await el.files[0].arrayBuffer())));
    const zipPath = path.join(temp,'folder.zip'); fs.writeFileSync(zipPath, Buffer.from(zipBytes));
    const check = spawnSync('python3',['-c',`import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert set(z.namelist()) == {'project.godot', 'игра.gd'}\n assert z.read('игра.gd') == b'extends Node\\n'\n assert z.testzip() is None`,zipPath], {encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
    let requests = 0;
    const key = path.join(temp, 'key.pem'), cert = path.join(temp, 'cert.pem');
    const generated = spawnSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'], {encoding:'utf8'});
    assert.equal(generated.status,0,generated.stderr);
    cloud = https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)}, (req,res) => {requests++; res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':'application/zip'});res.end(Buffer.from(zipBytes));});
    await new Promise(resolve => cloud.listen(0,'127.0.0.1',resolve));
    const cloudURL = `https://127.0.0.1:${cloud.address().port}/project.zip`;
    await page.locator('#redot-cloud-url').fill(cloudURL); await page.locator('#redot-cloud-load').click();
    await page.waitForFunction(() => /ZIP подготовлен|Не удалось/.test(document.querySelector('#redot-project-status').textContent));
    const status = await page.locator('#redot-project-status').textContent();
    if (!status.includes('ZIP подготовлен')) {
      const probe = await page.evaluate(async url => {try {let r=await fetch(url,{mode:'cors'}); return `OK ${r.status}`;} catch(e){return String(e)}}, cloudURL);
      const plain = await browser.newPage({ignoreHTTPSErrors:true}); await plain.goto('http://127.0.0.1:8765/project-open.html');
      const probePlain = await plain.evaluate(async url => {try {let r=await fetch(url,{mode:'cors'}); return `OK ${r.status}`;} catch(e){return String(e)}}, cloudURL);
      await plain.close();
      throw new Error(`${status}; TLS requests: ${requests}; editor fetch: ${probe}; plain fetch: ${probePlain}; browser: ${diagnostics.join(' | ')}`);
    }
    assert.equal(requests,1); assert.equal(await page.locator('#redot-cloud-url').inputValue(),'');
    assert.deepEqual(await page.locator('#zip-file').evaluate(async el=>Array.from(new Uint8Array(await el.files[0].arrayBuffer()))),zipBytes);
    await page.locator('#redot-cloud-url').fill('http://cloud.example/project.zip'); await page.locator('#redot-cloud-load').click();
    await page.waitForFunction(() => document.querySelector('#redot-project-status').textContent.includes('Не удалось'));
    assert.equal(await page.locator('#zip-file').evaluate(el=>el.files.length),0); assert.equal(requests,1);
    await page.goto('http://127.0.0.1:8765/project-open.html');
    await page.locator('#redot-cloud-url').fill(cloudURL);
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#redot-cloud-load').click()]);
    assert.equal(download.suggestedFilename(),'redot-project.zip'); const downloaded = await download.path(); assert.deepEqual(fs.readFileSync(downloaded),Buffer.from(zipBytes));
    assert.deepEqual(errors,[]);
    console.log('::notice title=Project preparation::Web shell prepared a local-folder ZIP and loaded an HTTPS ZIP through CORS; Android helper downloaded the same ZIP. ZIP contents verified. No Android device or editor import was tested.');
  } catch(e) { console.error('::error title=Project preparation::'+String(e.stack||e).replace(/%/g,'%25').replace(/\n/g,'%0A')); process.exitCode=1; }
  finally {if(browser) await browser.close(); if(cloud) await new Promise(resolve=>cloud.close(resolve)); server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
})();
