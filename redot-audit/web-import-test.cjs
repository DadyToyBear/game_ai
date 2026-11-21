// Exercise the genuine RC2 Web project manager with a project prepared by our UI.
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const secret = 'test-only-secret-012345678901234567890123456789';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'redot-web-import-'));
const project = path.join(temp, 'SourceProject');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Web Import Verification"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.writeFileSync(path.join(project, 'main.tscn'), '[gd_scene format=3]\n[node name="Game" type="Node2D"]\n');
const server = spawn('python3', ['redot-bridge/bridge.py','serve','--editor-dir',path.resolve(process.argv[2])], {env:{...process.env,REDOT_BRIDGE_TOKEN:secret},stdio:'ignore'});
async function waitServer() {for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8765/project-open.html')).ok)return;}catch(_){} await new Promise(r=>setTimeout(r,100));} throw Error('Bridge did not start');}
async function capture(page, label) {
  const data = (await page.screenshot({type:'jpeg',quality:45})).toString('base64');
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
    await page.locator('#redot-folder').setInputFiles(project);
    await page.waitForFunction(()=>document.querySelector('#zip-file').files.length === 1);
    await page.locator('#startButton').click();
    await page.waitForFunction(()=>{const n=document.querySelector('#status-notice'); if(n && n.style.display!=='none' && n.textContent.trim()) throw Error(n.textContent); const t=document.querySelector('#tab-editor'); return t && getComputedStyle(t).display!=='none';},null,{timeout:120000});
    let colors=0;
    for(let i=0;i<30;i++){await page.waitForTimeout(2000);const png=PNG.sync.read(await page.locator('#editor-canvas').screenshot());const set=new Set();for(let p=0;p<png.data.length;p+=64)set.add(`${png.data[p]>>4},${png.data[p+1]>>4},${png.data[p+2]>>4}`);colors=set.size;if(colors>=12)break;}
    assert.ok(colors>=12,`Blank editor (${colors} colors)`);
    await capture(page,'WEB_IMPORT_INITIAL');
    await page.locator('#editor-canvas').click({position:{x:300,y:300}});
    await page.keyboard.press('Control+i');
    await page.waitForTimeout(3000);
    await capture(page,'WEB_IMPORT_DIALOG');
    console.log('::notice title=Web import probe::Captured test project manager screens for automation development; import not yet asserted.');
  } catch(e) {console.error(`::error title=Web import::${String(e.stack||e).replace(/%/g,'%25').replace(/\n/g,'%0A')} Browser: ${issues.slice(-8).join(' | ')}`);process.exitCode=1;}
  finally {if(browser)await browser.close();server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
})();
