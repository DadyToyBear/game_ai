(() => {
  const $ = id => document.getElementById(id);
  let token = '', connected = false;
  function ui(enabled) { $('export').disabled = !enabled; $('import').disabled = !enabled; }
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(path, {...options, headers, cache: 'no-store'});
    if (!response.ok) throw new Error((await response.text()).slice(0, 400) || `HTTP ${response.status}`);
    return response;
  }
  $('connect').onclick = async () => {
    if (connected) { token = ''; connected = false; $('token').value = ''; $('token').disabled = false; $('connect').textContent = 'Подключить'; $('status').textContent = 'Отключено.'; ui(false); return; }
    token = $('token').value;
    if (!token) { $('status').textContent = 'Введите секрет моста.'; return; }
    try {
      const info = await (await request('/api/project/status')).json();
      if (!info.configured) throw new Error('Перезапустите мост с --project-dir и путём к проекту.');
      connected = true; $('token').value = ''; $('token').disabled = true;
      $('connect').textContent = 'Отключить'; $('status').textContent = `Проект: ${info.name}`; ui(true);
    } catch (e) { token = ''; $('status').textContent = `Не удалось подключиться: ${e.message}`; }
  };
  $('export').onclick = async () => {
    if (!confirm('Скачать снимок проекта? В нём могут быть приватные файлы.')) return;
    ui(false); $('status').textContent = 'Создаю снимок…';
    try {
      const blob = await (await request('/api/project/export')).blob();
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'redot-project-snapshot.zip'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); $('status').textContent = 'Снимок скачан. Откройте его в Web-редакторе.';
    } catch (e) { $('status').textContent = `Ошибка экспорта: ${e.message}`; }
    finally { ui(connected); }
  };
  $('import').onclick = async () => {
    const file = $('file').files[0];
    if (!file) { $('status').textContent = 'Выберите ZIP проекта.'; return; }
    if (file.size > 128 * 1024 * 1024) { $('status').textContent = 'ZIP больше 128 МиБ.'; return; }
    if (!confirm('Создать новую соседнюю папку из выбранного ZIP? Оригинальный проект не изменится.')) return;
    ui(false); $('status').textContent = 'Создаю новую копию…';
    try {
      const info = await (await request('/api/project/import', {method: 'POST', headers: {'Content-Type': 'application/zip'}, body: file})).json();
      $('status').textContent = `Копия создана: ${info.imported_to}. Откройте её в Redot и сравните с оригиналом.`;
    } catch (e) { $('status').textContent = `Ошибка импорта: ${e.message}`; }
    finally { ui(connected); }
  };
})();
