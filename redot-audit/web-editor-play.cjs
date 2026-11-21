// Exercise actual EditorInterface Play and game-canvas capture in the RC2 Web editor.
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
const mode = 'folder';
if (!['folder', 'registry'].includes(mode)) throw Error('Expected folder or registry mode');
const project = path.join(temp, 'SourceProject');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Web Play Audit"\nrun/main_scene="res://scenes/levels/main.tscn"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/audit/plugin.cfg")\n[display]\nwindow/size/viewport_width=320\nwindow/size/viewport_height=240\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.mkdirSync(path.join(project,'scenes','levels'), {recursive:true});
fs.mkdirSync(path.join(project,'addons','audit'), {recursive:true});
fs.writeFileSync(path.join(project, 'scenes','levels','main.tscn'), '[gd_scene format=3]\n[node name="Game" type="ColorRect"]\noffset_right=320.0\noffset_bottom=240.0\ncolor=Color(0.95,0.05,0.08,1)\n');
fs.writeFileSync(path.join(project, 'addons','audit','plugin.cfg'), '[plugin]\nname="Import Audit"\ndescription="Test only"\nauthor="test"\nversion="1"\nscript="plugin.gd"\n');
fs.writeFileSync(path.join(project, 'addons','audit','plugin.gd'), `@tool
extends EditorPlugin
func _enter_tree() -> void:
    JavaScriptBridge.eval("window.__redotImportEditorReady = true")
func _process(_delta: float) -> void:
    var command: String = str(JavaScriptBridge.eval("(() => { const c=window.__webPlayAuditCommand || ''; window.__webPlayAuditCommand=''; return c; })()"))
    if command == "play":
        EditorInterface.play_main_scene()
    elif command == "stop":
        EditorInterface.stop_playing_scene()
    JavaScriptBridge.eval("window.__webPlayAuditPlaying = " + ("true" if EditorInterface.is_playing_scene() else "false"))
`);
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
        return text(scene).includes('type="ColorRect"') && text(scene).includes('0.95,0.05,0.08') &&
          text(plugin).includes('__redotImportEditorReady') && text(config).includes('res://scenes/levels/main.tscn');
      } finally {db.close();}
    }, null, {timeout:60000});
    // Launch the imported project. Its test plugin marks the window only when
    // the actual editor (not the project manager) has loaded the project.
    await page.mouse.click(1205,115);
    await page.waitForFunction(() => window.__redotImportEditorReady === true, null, {timeout:120000});
    // Invoke the real editor interface from a test-only EditorPlugin.
    await page.evaluate(() => { window.__webPlayAuditCommand = 'play'; });
    await page.waitForFunction(() => !document.querySelector('#btn-tab-game').disabled && getComputedStyle(document.querySelector('#tab-game')).display !== 'none', null, {timeout:120000});
    const countRed = bytes => { const png=PNG.sync.read(bytes); let n=0; for(let i=0;i<png.data.length;i+=4) if(png.data[i]>140 && png.data[i+1]<100 && png.data[i+2]<100) n++; return n; };
    let pixels=0;
    for(let i=0;i<40;i++){await page.waitForTimeout(1000); pixels=countRed(await page.locator('#game-canvas').screenshot()); if(pixels>1000)break;}
    assert.ok(pixels>1000, `Web editor game did not render the red scene (${pixels} pixels)`);
    await page.locator('input[type=password]').last().fill(secret);
    await page.getByRole('button', {name:'Включить кадры игры'}).click();
    let frame;
    for(let i=0;i<30;i++){
      const response=await fetch('http://127.0.0.1:8765/api/frame',{headers:{Authorization:`Bearer ${secret}`}});
      if(response.ok) { assert.equal(response.headers.get('X-Redot-Source'),'web-game'); frame=Buffer.from(await response.arrayBuffer()); if(countRed(frame)>1000)break; }
      await page.waitForTimeout(1000);
    }
    assert.ok(frame && countRed(frame)>1000, 'Web editor game frame was blank or unavailable');
    console.log('::notice title=Real Web editor Play::The test EditorPlugin called play_main_scene; the resulting game canvas and bridge frame contained the red test scene.');
    await page.getByRole('button', {name:'Остановить кадры'}).click();
    await page.locator('#btn-close-game').click();
    await page.waitForFunction(() => document.querySelector('#btn-tab-game').disabled && getComputedStyle(document.querySelector('#tab-editor')).display !== 'none',null,{timeout:60000});
    console.log('::notice title=Web shell game close::The editor shell closed the running game and returned to the editor. EditorInterface.stop_playing_scene was not tested.');
    assert.deepEqual(treeDigest(project), original, 'The original project directory changed');
  } catch(e) {
    if(page) { try {await capture(page,'WEB_EDITOR_PLAY_FAILURE');} catch (_) {} }
    console.error(`::error title=Web editor Play::${String(e.stack||e).replace(/%/g,'%25').replace(/\n/g,'%0A')} Browser: ${issues.slice(-8).join(' | ')}`);process.exitCode=1;
  }
  finally {if(browser)await browser.close();server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
})();
