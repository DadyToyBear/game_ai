/* Explicit project-copy preparation. No network or folder access until the user acts. */
(() => {
  'use strict';
  if (window.__redotProjectOpen) return;
  window.__redotProjectOpen = true;
  const MAX_ARCHIVE = 128 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024, MAX_ENTRIES = 10000;
  const encoder = new TextEncoder();
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let n = i; for (let j = 0; j < 8; j++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : n >>> 1; table[i] = n >>> 0; }
  function crc32(data) { let crc = 0xffffffff; for (const b of data) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
  function header(size, fields) { const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); for (const [offset, value, length] of fields) { if (length === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value, true); } return bytes; }
  function validPath(p) {
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    return p && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..' && !/[\x00-\x1f:<>"|?*]/.test(s) && !/[. ]$/.test(s) && !reserved.test(s));
  }
  async function folderZip(input) {
    const selected = Array.from(input);
    if (!selected.length || selected.length > MAX_ENTRIES) throw Error('Папка пуста или содержит более 10 000 файлов.');
    const roots = new Set(selected.map(f => (f.webkitRelativePath || '').split('/')[0]));
    if (roots.size !== 1 || roots.has('')) throw Error('Не удалось прочитать структуру папки в этом браузере.');
    const files = [], seen = new Set(); let total = 22;
    for (const file of selected) {
      const parts = file.webkitRelativePath.split('/').slice(1);
      if (parts.some(p => ['.git', '.godot'].includes(p.toLowerCase()))) continue;
      const name = parts.join('/');
      if (!validPath(name)) throw Error('В проекте есть небезопасное или непереносимое имя файла.');
      const key = name.toLowerCase(); if (seen.has(key)) throw Error('Имена файлов различаются только регистром.'); seen.add(key);
      const encoded = encoder.encode(name);
      if (encoded.length > 65535 || file.size > MAX_FILE) throw Error('Имя слишком длинное или файл больше 64 МиБ.');
      total += 30 + 46 + encoded.length * 2 + file.size;
      if (total > MAX_ARCHIVE) throw Error('Проект превышает лимит 128 МиБ.');
      files.push({file, name, encoded});
    }
    if (!files.some(f => f.name === 'project.godot')) throw Error('Выберите корневую папку с project.godot.');
    const local = [], central = []; let offset = 0;
    for (const {file, encoded} of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) throw Error('Размер файла изменился; попробуйте снова.');
      const crc = crc32(bytes), size = bytes.length;
      const lh = header(30, [[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,crc,4],[18,size,4],[22,size,4],[26,encoded.length,2]]);
      const ch = header(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,crc,4],[20,size,4],[24,size,4],[28,encoded.length,2],[42,offset,4]]);
      local.push(lh, encoded, bytes); central.push(ch, encoded); offset += lh.length + encoded.length + size;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = header(22, [[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,centralSize,4],[16,offset,4]]);
    return new Blob([...local, ...central, end], {type:'application/zip'});
  }
  function allowedURL(value) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw Error('Используйте HTTPS или локальный HTTP; данные авторизации в адресе недопустимы.');
    return url;
  }
  async function cloudZip(value) {
    const url = allowedURL(value);
    const response = await fetch(url.href, {mode:'cors', credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', cache:'no-store'});
    if (!response.ok) throw Error(`Сервер вернул HTTP ${response.status}.`);
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > MAX_ARCHIVE) throw Error('ZIP больше 128 МиБ.');
    if (!response.body) throw Error('Браузер не поддерживает потоковую загрузку.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { while (true) { const {done, value:chunk} = await reader.read(); if (done) break; size += chunk.length; if (size > MAX_ARCHIVE) throw Error('ZIP больше 128 МиБ.'); chunks.push(chunk); } }
    finally { await reader.cancel().catch(() => {}); }
    const blob = new Blob(chunks, {type:'application/zip'});
    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || !((signature[2] === 3 && signature[3] === 4) || (signature[2] === 5 && signature[3] === 6))) throw Error('Ответ не похож на ZIP. Укажите прямую ссылку на ZIP.');
    return blob;
  }
  function download(blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='redot-project.zip'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const editorInput = document.getElementById('zip-file');
  const host = editorInput ? editorInput.parentElement : document.getElementById('project-open');
  if (!host) return;
  const section = document.createElement('section');
  section.style.cssText = 'margin:1em 0;padding:1em;border:1px solid #68758a;border-radius:6px;max-width:38em;text-align:left';
  section.innerHTML = '<strong>Открыть копию проекта</strong><p>Папка или прямая ссылка на ZIP. Это копия, не синхронизация. Используйте только доверенные проекты.</p><label>Локальная папка: <input id="redot-folder" type="file" webkitdirectory multiple></label><br><label>Прямая HTTPS-ссылка на ZIP: <input id="redot-cloud-url" type="url" autocomplete="off" placeholder="https://…/project.zip"></label> <button type="button" id="redot-cloud-load">Загрузить ZIP</button><p id="redot-project-status" role="status">Исходные файлы не изменяются. .git и .godot исключаются из копии папки.</p>';
  if (editorInput) {
    editorInput.parentNode.insertBefore(section, editorInput.nextSibling);
    const loader = document.getElementById('tab-loader');
    if (loader) Object.assign(loader.style, {maxHeight:'calc(100vh - 55px)', overflowY:'auto', touchAction:'pan-y'});
  } else host.append(section);
  const folder = section.querySelector('#redot-folder'), field = section.querySelector('#redot-cloud-url'), button = section.querySelector('#redot-cloud-load'), status = section.querySelector('#redot-project-status');
  const start = document.getElementById('startButton');
  async function prepare(action) {
    if (editorInput) editorInput.value = '';
    const wasStartDisabled = start ? start.disabled : false;
    folder.disabled = true; button.disabled = true; if (start) start.disabled = true;
    status.textContent = 'Подготовка копии…';
    try {
      const blob = await action();
      if (editorInput) {
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'redot-project.zip', {type:'application/zip'})); editorInput.files = transfer.files;
        status.textContent = 'ZIP подготовлен. Нажмите Start Redot editor, затем импортируйте /tmp/preload.zip в менеджере проектов.';
      } else { download(blob); status.textContent = 'ZIP скачан. В Android Redot импортируйте его в новую папку.'; }
    } catch (e) { status.textContent = `Не удалось подготовить копию: ${e.message}. Для облака нужны прямая ссылка и разрешение CORS.`; }
    finally { folder.disabled = false; button.disabled = false; if (start) start.disabled = wasStartDisabled; }
  }
  // One implementation for Web and the Android helper. Paths are resolved by
  // the machine running the local bridge, not by the device's browser.
  const registry = document.createElement('details');
  registry.innerHTML = '<summary>Папки и подключённые сетевые диски на машине моста</summary><p>Путь должен быть доступен мосту и содержать project.godot. Диск сначала подключается средствами ОС. В Web и Android передаётся копия, не прямая запись.</p><label>Секрет моста <input id="reg-token" type="password" autocomplete="off"></label> <button type="button" id="reg-connect">Подключить мост</button><br><label>Путь к проекту <input id="reg-path" type="text" autocomplete="off" placeholder="C:\\Projects\\Game или /mnt/share/game"></label> <button type="button" id="reg-add" disabled>Добавить папку</button><br><label>Папки <select id="reg-list" disabled></select></label> <button type="button" id="reg-use" disabled>Подготовить копию</button> <button type="button" id="reg-remove" disabled>Убрать из списка</button><p id="reg-status" role="status">Отключено. Список хранится только до остановки моста.</p>';
  section.append(registry);
  const reg = id => registry.querySelector('#reg-' + id);
  let bridgeToken = '', regBusy = false;
  function regButtons() {
    reg('connect').disabled = regBusy;
    reg('add').disabled = regBusy || !bridgeToken;
    reg('list').disabled = regBusy || !bridgeToken;
    reg('use').disabled = regBusy || !bridgeToken || !reg('list').value;
    reg('remove').disabled = regBusy || !bridgeToken || !reg('list').value;
  }
  async function bridgeRequest(path, payload) {
    const options = {headers:{Authorization:`Bearer ${bridgeToken}`}, cache:'no-store'};
    if (payload) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(payload); }
    const response = await fetch(path, options);
    if (!response.ok) throw Error((await response.text()).slice(0, 200) || `HTTP ${response.status}`);
    return response;
  }
  async function refresh(selected) {
    const result = await (await bridgeRequest('/api/projects')).json();
    const list = reg('list'); list.replaceChildren();
    for (const p of result.projects) { const option = document.createElement('option'); option.value = p.id; option.textContent = `${p.name} — ${p.path}`; list.append(option); }
    if (selected && result.projects.some(p => p.id === selected)) list.value = selected;
  }
  async function operate(action) {
    if (regBusy) return; regBusy = true; regButtons();
    try { await action(); } catch (e) { reg('status').textContent = `Ошибка: ${e.message}`; }
    finally { regBusy = false; regButtons(); }
  }
  reg('connect').addEventListener('click', () => operate(async () => {
    if (bridgeToken) { bridgeToken=''; reg('token').value=''; reg('token').disabled=false; reg('connect').textContent='Подключить мост'; reg('list').replaceChildren(); reg('status').textContent='Отключено. Файлы не удалены.'; return; }
    bridgeToken = reg('token').value; reg('token').value = '';
    if (!bridgeToken) throw Error('Введите секрет моста.');
    try { await refresh(); } catch (e) { bridgeToken=''; throw e; }
    reg('token').disabled=true; reg('connect').textContent='Отключить мост'; reg('status').textContent='Мост подключён. Укажите путь на машине моста.';
  }));
  reg('add').addEventListener('click', () => operate(async () => {
    const path = reg('path').value.trim();
    const result = await (await bridgeRequest('/api/projects/add', {path})).json();
    await refresh(result.project.id); reg('path').value='';
    reg('status').textContent = result.created ? 'Папка добавлена в список без копирования файлов.' : 'Эта папка уже есть в списке; повторная запись не создана.';
  }));
  reg('list').addEventListener('change', regButtons);
  reg('remove').addEventListener('click', () => operate(async () => {
    const id = reg('list').value;
    if (!id || !confirm('Убрать папку из списка? Файлы проекта не удаляются.')) return;
    await bridgeRequest('/api/projects/remove', {id}); await refresh(); reg('status').textContent='Папка убрана из списка; файлы не изменены.';
  }));
  reg('use').addEventListener('click', () => operate(async () => {
    const id = reg('list').value;
    if (!id || !confirm('Создать копию проекта? Снимок может содержать приватные файлы.')) return;
    await prepare(async () => (await bridgeRequest('/api/projects/export', {id})).blob());
  }));
  regButtons();
  folder.addEventListener('change', () => { if (folder.files.length) prepare(() => folderZip(folder.files)); });
  button.addEventListener('click', () => { const value = field.value.trim(); field.value = ''; if (!value) {status.textContent='Введите прямую ссылку на ZIP.'; return;} prepare(() => cloudZip(value)); });
})();
