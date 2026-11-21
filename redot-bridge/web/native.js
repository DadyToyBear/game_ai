(() => {
  const $ = id => document.getElementById(id);
  let token = '', active = false, busy = false, timer = null, latest = null, generation = 0;
  let recorder = null, recorded = [], stream = null, recordTimer = null;
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  const buttons = ['play', 'stop', 'snapshot', 'delete', 'record'];
  function controls(enabled) { for (const name of buttons) $(name).disabled = !enabled; }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(path, {...options, headers, cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }
  function clearFrame() { latest = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  async function refresh() {
    if (!active || busy) return;
    const currentGeneration = generation;
    busy = true;
    try {
      const state = await (await request('/api/status')).json();
      if (!active || currentGeneration !== generation) return;
      let label = state.editor_connected ? (state.playing ? 'Игра запущена' : 'Редактор подключён, игра остановлена') : 'Редактор не подключён';
      if (state.pending) label += ' · команда ожидает редактор';
      if (state.frame_available && state.frame_source === 'native-game') label += ` · последний кадр: ${state.frame_age_seconds} с назад`;
      else if (state.frame_available) label += ' · кадр от другого источника (не показан)';
      $('status').textContent = label;
      if (state.frame_available && state.frame_source === 'native-game') {
        const blob = await (await request('/api/frame')).blob();
        if (!active || currentGeneration !== generation) return;
        const image = await createImageBitmap(blob);
        if (!active || currentGeneration !== generation) { image.close(); return; }
        if (canvas.width !== image.width || canvas.height !== image.height) {
          canvas.width = image.width; canvas.height = image.height;
        }
        ctx.drawImage(image, 0, 0); image.close(); latest = blob;
      } else {
        clearFrame();
      }
    } catch (err) { if (active && currentGeneration === generation) $('status').textContent = `Мост недоступен: ${err.message}`; }
    finally { busy = false; }
  }
  $('connect').onclick = () => {
    if (active) {
      active = false; generation++; clearInterval(timer); if (recorder && recorder.state !== 'inactive') recorder.stop();
      token = ''; clearFrame(); $('token').value = ''; $('token').disabled = false;
      $('connect').textContent = 'Подключить'; $('status').textContent = 'Отключено'; controls(false); return;
    }
    token = $('token').value;
    if (!token) { $('status').textContent = 'Введите секрет моста.'; return; }
    $('token').value = ''; $('token').disabled = true; active = true; controls(true);
    $('connect').textContent = 'Отключить'; refresh(); timer = setInterval(refresh, 1000);
  };
  async function command(value) {
    try {
      await request('/api/command', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({command: value})});
      $('status').textContent = 'Команда поставлена в очередь; ожидаем подтверждения состояния.';
    } catch (err) { $('status').textContent = `Команда не отправлена: ${err.message}`; }
  }
  $('play').onclick = () => command('play');
  $('stop').onclick = () => command('stop');
  $('snapshot').onclick = () => { if (latest) download(latest, latest.type === 'image/jpeg' ? 'redot-game.jpg' : 'redot-game.png'); else $('status').textContent = 'Кадров пока нет.'; };
  $('delete').onclick = async () => {
    try { await request('/api/frame', {method: 'DELETE'}); generation++; clearFrame(); $('status').textContent = 'Кадр удалён из памяти моста. Во время игры новый кадр появится снова.'; }
    catch (err) { $('status').textContent = `Не удалось удалить кадр: ${err.message}`; }
  };
  $('record').onclick = () => {
    if (recorder && recorder.state !== 'inactive') { recorder.stop(); return; }
    if (!latest) { $('status').textContent = 'Нет кадра для записи.'; return; }
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/webm')) { $('status').textContent = 'Браузер не поддерживает запись canvas в WebM.'; return; }
    try {
      recorded = []; stream = canvas.captureStream(2); recorder = new MediaRecorder(stream, {mimeType: 'video/webm'});
      recorder.ondataavailable = e => { if (e.data.size) recorded.push(e.data); };
      recorder.onstop = () => { clearTimeout(recordTimer); stream.getTracks().forEach(track => track.stop()); if (recorded.length) download(new Blob(recorded, {type: 'video/webm'}), 'redot-game.webm'); $('record').textContent = 'Начать запись WebM'; recorder = null; stream = null; recorded = []; };
      recorder.start(); $('record').textContent = 'Остановить запись';
      recordTimer = setTimeout(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); }, 60000);
    } catch (err) { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; recorder = null; $('status').textContent = `Запись недоступна: ${err.message}`; }
  };
  window.addEventListener('beforeunload', () => {if (recorder && recorder.state !== 'inactive') recorder.stop();});
})();
