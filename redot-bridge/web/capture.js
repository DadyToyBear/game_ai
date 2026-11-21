/* User-initiated game-canvas publishing. Does not capture the desktop or editor. */
(() => {
  let running = false;
  let timer = null;
  let controller = null;
  let generation = 0;
  const api = {
    start({canvas, token, source = 'unspecified', onStatus = () => {}, interval = 2000}) {
      if (running) throw new Error('Capture is already running.');
      if (typeof canvas !== 'function' || !token) throw new Error('Canvas provider and token are required.');
      running = true;
      const session = ++generation;
      interval = Math.max(1000, interval);
      const tick = async () => {
        if (!running || session !== generation) return;
        try {
          const element = canvas();
          if (!element || !element.isConnected || !element.width || !element.height || !element.getClientRects().length) {
            onStatus('Игра не открыта или не видна; ожидаю.');
          } else {
            const blob = await new Promise((resolve, reject) => {
              try { element.toBlob(resolve, 'image/png'); } catch (e) { reject(e); }
            });
            if (!running || session !== generation) return;
            if (!blob) throw new Error('Браузер не смог получить кадр canvas.');
            controller = new AbortController();
            const res = await fetch('/api/frame', {
              method: 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'image/png', 'X-Redot-Source': source === 'web-game' ? 'web-game' : 'unspecified'},
              body: blob, cache: 'no-store', signal: controller.signal,
            });
            if (!running || session !== generation) return;
            if (!res.ok) throw new Error(`Мост ответил HTTP ${res.status}.`);
            onStatus('Кадр игры передан в мост.');
          }
        } catch (error) {
          if (running && session === generation) onStatus(`Ошибка: ${error.message}`);
        }
        if (running && session === generation) timer = setTimeout(tick, interval);
      };
      tick();
    },
    stop() {
      running = false;
      generation++;
      clearTimeout(timer);
      if (controller) controller.abort();
      controller = null;
    },
    isRunning() { return running; },
  };
  window.RedotFrameCapture = api;
})();
