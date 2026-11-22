// Exercise the genuine RC2 Web project manager with a project prepared by our UI.
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const secret = 'test-only-secret-012345678901234567890123456789';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'redot-web-import-'));
const mode = process.argv[3] || 'folder';
if (!['folder', 'registry'].includes(mode)) throw Error('Expected folder or registry mode');
const project = path.join(temp, 'SourceProject');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Web Import Verification"\nrun/main_scene="res://scenes/levels/main.tscn"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/audit/plugin.cfg")\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.mkdirSync(path.join(project,'scenes','levels'), {recursive:true});
fs.mkdirSync(path.join(project,'addons','audit'), {recursive:true});
fs.writeFileSync(path.join(project, 'scenes','levels','main.tscn'), '[gd_scene format=3]\n[node name="Game" type="Node2D"]\n');
fs.writeFileSync(path.join(project, 'addons','audit','plugin.cfg'), '[plugin]\nname="Import Audit"\ndescription="Test only"\nauthor="test"\nversion="1"\nscript="plugin.gd"\n');
fs.writeFileSync(path.join(project, 'addons','audit','plugin.gd'), '@tool\nextends EditorPlugin\nfunc _enter_tree() -> void:\n\tJavaScriptBridge.eval("window.__redotImportEditorReady = true")\n');
function treeDigest(dir) {
  const records = [];
  function walk(root, prefix='') {
    for (const entry of fs.readdirSync(root, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name, full = path.join(root,entry.name);
      if (entry.isDirectory()) {records.push(`dir:${rel}`); walk(full, rel+'/');}
      else if (entry.isFile()) records.push(`file:${rel}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      else throw Error('Unexpected source file type');
    }
  }
  walk(dir); return records;
}
const original = treeDigest(project);
const server = spawn('python3', ['redot-bridge/bridge.py','serve','--editor-dir',path.resolve(process.argv[2])], {env:{...process.env,REDOT_BRIDGE_TOKEN:secret},stdio:'ignore'});
async function waitServer() {for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8765/project-open.html')).ok)return;}catch(_){} await new Promise(r=>setTimeout(r,100));} throw Error('Bridge did not start');}
async function capture(page, label) {
  const data = (await page.screenshot({type:'jpeg',quality:15})).toString('base64');
  for (let i=0;i<data.length;i+=3500) console.log(`::notice title=${label}_${String(i/3500).padStart(2,'0')}::${data.slice(i,i+3500)}`);
}
(async () => { let browser, page; const issues=[];
  try {
    await waitServer();
    browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    page = await browser.newPage({viewport:{width:1280,height:800}});
    page.on('pageerror', e=>issues.push(String(e)));
    page.on('console', m=>{if(m.type()==='error') issues.push(m.text());});
    await page.goto('http://127.0.0.1:8765/editor/godot.editor.html', {waitUntil:'load'});
    await page.locator('#welcome-modal-dismiss').click();
    if (mode === 'folder') {
      await page.locator('#redot-folder').setInputFiles(project);
    } else {
      await page.locator('summary').filter({hasText:'сетевые диски'}).click();
      await page.locator('#reg-token').fill(secret); await page.locator('#reg-connect').click();
      await page.waitForFunction(()=>document.querySelector('#reg-status').textContent.includes('Мост подключён'));
      await page.locator('#reg-path').fill(project); await page.locator('#reg-add').click();
      await page.waitForFunction(()=>document.querySelector('#reg-status').textContent.includes('Папка добавлена'));
      page.on('dialog', dialog => dialog.accept());
      await page.locator('#reg-use').click();
    }
    await page.waitForFunction(()=>document.querySelector('#zip-file').files.length === 1);
    await page.locator('#startButton').click();
    await page.waitForFunction(()=>{const n=document.querySelector('#status-notice'); if(n && n.style.display!=='none' && n.textContent.trim()) throw Error(n.textContent); const t=document.querySelector('#tab-editor'); return t && getComputedStyle(t).display!=='none';},null,{timeout:120000});
    let colors=0;
    for(let i=0;i<30;i++){await page.waitForTimeout(2000);const png=PNG.sync.read(await page.locator('#editor-canvas').screenshot());const set=new Set();for(let p=0;p<png.data.length;p+=64)set.add(`${png.data[p]>>4},${png.data[p+1]>>4},${png.data[p+2]>>4}`);colors=set.size;if(colors>=12)break;}
    assert.ok(colors>=12,`Blank editor (${colors} colors)`);
    // RC2 automatically displays the Install Project dialog for preload.zip.
    // Uncheck Edit Now to keep the project manager alive for inspection.
    await page.mouse.click(615,492);
    await page.mouse.click(713,522);
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('/home/web_user'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);});
      try {
        const tx = db.transaction('FILE_DATA'); const store = tx.objectStore('FILE_DATA');
        const read = key => new Promise((resolve,reject)=>{const r=store.get(key); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);});
        const [scene, plugin, config] = await Promise.all([
          read('/home/web_user/preload/scenes/levels/main.tscn'),
          read('/home/web_user/preload/addons/audit/plugin.gd'),
          read('/home/web_user/preload/project.godot')]);
        const text = entry => entry && entry.contents ? new TextDecoder().decode(entry.contents) : '';
        return text(scene) === '[gd_scene format=3]\n[node name="Game" type="Node2D"]\n' &&
          text(plugin).includes('__redotImportEditorReady') && text(config).includes('res://scenes/levels/main.tscn');
      } finally {db.close();}
    }, null, {timeout:60000});
    // Launch the imported project. Its test plugin marks the window only when
    // the actual editor (not the project manager) has loaded the project.
    await page.mouse.click(1205,115);
    await page.waitForFunction(() => window.__redotImportEditorReady === true, null, {timeout:120000});
    assert.deepEqual(treeDigest(project), original, 'The original project directory changed');
    console.log(`::notice title=Real Web project import::RC2 installed a ${mode} snapshot including nested files in IndexedDB and opened it in the editor; the test editor plugin ran. Original folder was not modified (Chromium, software WebGL).`);
  } catch(e) {
    if(page) { try {await capture(page,'WEB_IMPORT_FAILURE');} catch (_) {} }
    console.error(`::error title=Web import::${String(e.stack||e).replace(/%/g,'%25').replace(/\n/g,'%0A')} Browser: ${issues.slice(-8).join(' | ')}`);process.exitCode=1;
  }
  finally {if(browser)await browser.close();server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
})();
