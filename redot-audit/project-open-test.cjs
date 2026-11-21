// Browser integration of folder and HTTPS ZIP preparation; real editor shell.
const {chromium} = require('playwright');
const {spawn, spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const editor = path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'redot-folder-'));
const folder = path.join(temp, 'Project'); fs.mkdirSync(path.join(folder, '.git'), {recursive:true}); fs.mkdirSync(path.join(folder, '.godot'));
fs.writeFileSync(path.join(folder, 'project.godot'), 'config_version=5\n');
fs.writeFileSync(path.join(folder, 'игра.gd'), 'extends Node\n');
fs.writeFileSync(path.join(folder, '.git', 'secret'), 'excluded'); fs.writeFileSync(path.join(folder, '.godot', 'cache'), 'excluded');
const server = spawn('python3', ['redot-bridge/bridge.py','serve','--editor-dir',editor], {env:{...process.env,REDOT_BRIDGE_TOKEN:'test-only-secret-012345678901234567890123456789'},stdio:'ignore'});
async function waitServer() {for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8765/project-open.html')).ok)return;}catch(_){} await new Promise(r=>setTimeout(r,100));} throw Error('Bridge did not start');}
(async () => { let browser;
  try {
    await waitServer(); browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({acceptDownloads:true}); const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:8765/editor/godot.editor.html');
    await page.locator('#welcome-modal-dismiss').click();
    await page.locator('#redot-folder').setInputFiles(folder);
    await page.waitForFunction(() => document.querySelector('#zip-file').files.length === 1);
    const zipBytes = await page.locator('#zip-file').evaluate(async el => Array.from(new Uint8Array(await el.files[0].arrayBuffer())));
    const zipPath = path.join(temp,'folder.zip'); fs.writeFileSync(zipPath, Buffer.from(zipBytes));
    const check = spawnSync('python3',['-c',`import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert set(z.namelist()) == {'project.godot', 'игра.gd'}\n assert z.read('игра.gd') == b'extends Node\\n'\n assert z.testzip() is None`,zipPath], {encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
    let requests = 0;
    await page.route('https://cloud.example/**', async route => {requests++; await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/zip'},body:Buffer.from(zipBytes)});});
    await page.locator('#redot-cloud-url').fill('https://cloud.example/project.zip'); await page.locator('#redot-cloud-load').click();
    await page.waitForFunction(() => /ZIP подготовлен|Не удалось/.test(document.querySelector('#redot-project-status').textContent));
    assert.match(await page.locator('#redot-project-status').textContent(), /ZIP подготовлен/);
    assert.equal(requests,1); assert.equal(await page.locator('#redot-cloud-url').inputValue(),'');
    assert.deepEqual(await page.locator('#zip-file').evaluate(async el=>Array.from(new Uint8Array(await el.files[0].arrayBuffer()))),zipBytes);
    await page.locator('#redot-cloud-url').fill('http://cloud.example/project.zip'); await page.locator('#redot-cloud-load').click();
    await page.waitForFunction(() => document.querySelector('#redot-project-status').textContent.includes('Не удалось'));
    assert.equal(await page.locator('#zip-file').evaluate(el=>el.files.length),0); assert.equal(requests,1);
    await page.goto('http://127.0.0.1:8765/project-open.html');
    await page.locator('#redot-cloud-url').fill('https://cloud.example/project.zip');
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#redot-cloud-load').click()]);
    assert.equal(download.suggestedFilename(),'redot-project.zip'); const downloaded = await download.path(); assert.deepEqual(fs.readFileSync(downloaded),Buffer.from(zipBytes));
    assert.deepEqual(errors,[]);
    console.log('::notice title=Project preparation::Web shell prepared a local-folder ZIP and loaded an HTTPS ZIP through CORS; Android helper downloaded the same ZIP. ZIP contents verified. No Android device or editor import was tested.');
  } catch(e) { console.error('::error title=Project preparation::'+String(e.stack||e).replace(/%/g,'%25').replace(/\n/g,'%0A')); process.exitCode=1; }
  finally {if(browser) await browser.close();server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
})();
