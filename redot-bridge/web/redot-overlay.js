/* A small opt-in overlay for Redot's web editor shell; not an EditorPlugin. */
(() => {
  const panel = document.createElement('div');
  Object.assign(panel.style, {position: 'fixed', bottom: '8px', right: '8px', zIndex: '999999', background: '#172033', color: '#fff', padding: '10px', borderRadius: '6px', font: '14px sans-serif', maxWidth: '320px'});
  const title = document.createElement('strong'); title.textContent = 'Мост: кадры игры';
  const input = document.createElement('input'); input.type = 'password'; input.placeholder = 'Секрет моста'; input.autocomplete = 'off';
  input.style.display = 'block'; input.style.margin = '8px 0';
  const button = document.createElement('button'); button.textContent = 'Включить кадры игры';
  const status = document.createElement('p'); status.textContent = 'Выключено. Секрет не сохраняется.';
  status.setAttribute('role', 'status');
  button.addEventListener('click', () => {
    if (window.RedotFrameCapture.isRunning()) {
      window.RedotFrameCapture.stop(); input.value = ''; input.disabled = false;
      button.textContent = 'Включить кадры игры'; status.textContent = 'Выключено; последний кадр остаётся в мосту до удаления.';
      return;
    }
    const token = input.value;
    if (!token) { status.textContent = 'Введите секрет моста.'; return; }
    try {
      window.RedotFrameCapture.start({canvas: () => document.getElementById('game-canvas'), token, source: 'web-game', onStatus: s => {status.textContent = s;}});
      input.value = ''; input.disabled = true; button.textContent = 'Остановить кадры';
    } catch (error) { status.textContent = error.message; }
  });
  panel.append(title, input, button, status); document.body.append(panel);
})();
