/* User-initiated game-canvas publishing. Does not capture the desktop or editor. */
(() => {
  let running = false;
  let timer = null;
  let pending = null;
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
        const job = {controller: new AbortController(), timeout: null};
        pending = job;
        const current = () => running && session === generation && pending === job;
        // Bound the whole operation, including an unresponsive canvas toBlob.
        // An old callback cannot publish a frame after timeout or stop.
        job.timeout = setTimeout(() => {
          if (!current()) return;
          pending = null;
          job.controller.abort();
          onStatus('Ошибка: время ожидания кадра или моста истекло; повторяю.');
          if (running && session === generation && pending === null) timer = setTimeout(tick, interval);
        }, 10000);
        try {
          const element = canvas();
          if (!element || !element.isConnected || !element.width || !element.height || !element.getClientRects().length) {
            onStatus('Игра не открыта или не видна; ожидаю.');
          } else {
            const blob = await new Promise((resolve, reject) => {
              try { element.toBlob(resolve, 'image/png'); } catch (e) { reject(e); }
            });
            if (!current()) return;
            if (!blob) throw new Error('Браузер не смог получить кадр canvas.');
            const res = await fetch('/api/frame', {
              method: 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'image/png', 'X-Redot-Source': source === 'web-game' ? 'web-game' : 'unspecified'},
              body: blob, cache: 'no-store', signal: job.controller.signal,
            });
            if (!current()) return;
            if (!res.ok) throw new Error(`Мост ответил HTTP ${res.status}.`);
            onStatus('Кадр игры передан в мост.');
          }
        } catch (error) {
          if (current()) onStatus(`Ошибка: ${error.message}`);
        } finally {
          clearTimeout(job.timeout);
          if (current()) {
            pending = null;
            timer = setTimeout(tick, interval);
          }
        }
      };
      tick();
    },
    stop() {
      running = false;
      generation++;
      clearTimeout(timer);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.controller.abort();
        pending = null;
      }
    },
    isRunning() { return running; },
  };
  window.RedotFrameCapture = api;
})();
