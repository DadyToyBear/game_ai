(() => {
  const $ = id => document.getElementById(id);
  let token = '', active = false, refreshTask = null, timer = null, latest = null, generation = 0;
  let recorder = null, recorded = [], stream = null, recordTimer = null, logsGeneration = 0;
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  const buttons = ['play', 'stop', 'snapshot', 'delete', 'record', 'load-logs', 'delete-logs'];
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
  const isGameSource = source => source === 'native-game' || source === 'web-game';
  function clearFrame() { latest = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function cancelRefresh() {
    const task = refreshTask;
    refreshTask = null;
    if (task) { clearTimeout(task.timeout); task.controller.abort(); }
  }
  async function refresh() {
    if (!active || refreshTask) return;
    const currentGeneration = generation;
    const task = {controller: new AbortController(), timeout: null};
    refreshTask = task;
    // Cover both HTTP headers and response body. A stalled bridge must not
    // prevent polling forever or block a later connection.
    task.timeout = setTimeout(() => {
      if (refreshTask !== task) return;
      refreshTask = null; task.controller.abort();
      if (active && currentGeneration === generation) {
        clearFrame(); $('status').textContent = 'Кадр или мост недоступен: время ожидания истекло.';
      }
    }, 10000);
    try {
      const state = await (await request('/api/status', {signal: task.controller.signal})).json();
      if (!active || currentGeneration !== generation || refreshTask !== task) return;
      let label = state.editor_connected ? (state.playing ? 'Игра запущена' : 'Редактор подключён, игра остановлена') : 'Редактор не подключён';
      if (state.pending) label += ' · команда ожидает редактор';
      if (state.frame_available && !isGameSource(state.frame_source)) label += ' · кадр от другого источника (не показан)';
      $('status').textContent = label;
      if (state.frame_available && isGameSource(state.frame_source)) {
        // The frame can change after /status. Validate the label on the same
        // response as the bytes, not only the earlier status response.
        const response = await request('/api/frame', {signal: task.controller.signal});
        if (!active || currentGeneration !== generation || refreshTask !== task) return;
        const frameSource = response.headers.get('X-Redot-Source');
        if (!isGameSource(frameSource)) {
          clearFrame(); $('status').textContent = 'Источник кадра не указан; кадр не показан.'; return;
        }
        const blob = await response.blob();
        if (!active || currentGeneration !== generation || refreshTask !== task) return;
        const image = await createImageBitmap(blob);
        if (!active || currentGeneration !== generation || refreshTask !== task) { image.close(); return; }
        if (canvas.width !== image.width || canvas.height !== image.height) {
          canvas.width = image.width; canvas.height = image.height;
        }
        ctx.drawImage(image, 0, 0); image.close(); latest = blob;
        // This header refers to the same frame response, unlike /status which
        // may have described a different frame by the time we fetched it.
        const ageHeader = response.headers.get('X-Redot-Frame-Age') || '';
        const age = /^\d{1,12}(?:\.\d{1,3})?$/.test(ageHeader) ? Number(ageHeader) : null;
        const ageLabel = age === null ? 'возраст кадра неизвестен' : `получен мостом ${age.toFixed(1)} с назад${age >= 5 ? ' (возможно устарел)' : ''}`;
        $('status').textContent = `${label} · источник заявлен как ${frameSource} · ${ageLabel}`;
      } else {
        clearFrame();
      }
    } catch (err) { if (active && currentGeneration === generation && refreshTask === task) { clearFrame(); $('status').textContent = `Кадр или мост недоступен: ${err.message}`; } }
    finally { clearTimeout(task.timeout); if (refreshTask === task) refreshTask = null; }
  }
  $('connect').onclick = () => {
    if (active) {
      active = false; generation++; logsGeneration++; clearInterval(timer); cancelRefresh(); if (recorder && recorder.state !== 'inactive') recorder.stop();
      token = ''; clearFrame(); $('logs').textContent = ''; $('token').value = ''; $('token').disabled = false;
      $('connect').textContent = 'Подключить'; $('status').textContent = 'Отключено'; controls(false); return;
    }
    token = $('token').value;
    if (!token) { $('status').textContent = 'Введите секрет моста.'; return; }
    $('token').value = ''; $('token').disabled = true; active = true; controls(true);
    $('connect').textContent = 'Отключить'; refresh(); timer = setInterval(refresh, 1000);
  };
  async function command(value) {
    const current = generation;
    try {
      await request('/api/command', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({command: value})});
      if (active && current === generation) $('status').textContent = 'Команда поставлена в очередь; ожидаем подтверждения состояния.';
    } catch (err) { if (active && current === generation) $('status').textContent = `Команда не отправлена: ${err.message}`; }
  }
  $('play').onclick = () => command('play');
  $('stop').onclick = () => command('stop');
  $('snapshot').onclick = () => { if (latest) download(latest, latest.type === 'image/jpeg' ? 'redot-game.jpg' : 'redot-game.png'); else $('status').textContent = 'Кадров пока нет.'; };
  $('delete').onclick = async () => {
    const current = generation;
    try {
      await request('/api/frame', {method: 'DELETE'});
      if (!active || current !== generation) return;
      generation++; cancelRefresh(); clearFrame(); $('status').textContent = 'Кадр удалён из памяти моста. Во время игры новый кадр появится снова.';
    } catch (err) { if (active && current === generation) $('status').textContent = `Не удалось удалить кадр: ${err.message}`; }
  };
  $('load-logs').onclick = async () => {
    const current = logsGeneration;
    try {
      const data = await (await request('/api/logs')).json();
      if (!active || current !== logsGeneration) return;
      $('logs').textContent = data.entries.map(entry => `[${new Date(entry.received_at * 1000).toLocaleString()}] ${entry.source}/${entry.level}: ${entry.message}`).join('\n') || 'Журнал пуст.';
    } catch (err) { if (active && current === logsGeneration) $('status').textContent = `Не удалось получить журнал: ${err.message}`; }
  };
  $('delete-logs').onclick = async () => {
    const current = logsGeneration;
    try {
      await request('/api/logs', {method: 'DELETE'});
      if (!active || current !== logsGeneration) return;
      logsGeneration++; $('logs').textContent = ''; $('status').textContent = 'Журнал моста очищен; новые сообщения могут появиться снова.';
    } catch (err) { if (active && current === logsGeneration) $('status').textContent = `Не удалось очистить журнал: ${err.message}`; }
  };
  $('record').onclick = () => {
    if (recorder) {
      if (recorder.state !== 'inactive') recorder.stop();
      else $('status').textContent = 'Предыдущая запись ещё сохраняется.';
      return;
    }
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
