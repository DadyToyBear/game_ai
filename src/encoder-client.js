const RESPONSE_TIMEOUT = 45_000;

export function connectEncoder(worker, signal, timeout = RESPONSE_TIMEOUT) {
  let pending;
  let failure;

  function settle(method, value) {
    if (!pending) return;
    const request = pending;
    pending = undefined;
    clearTimeout(request.timer);
    request[method](value);
  }

  function fail(error) {
    failure ??= error;
    settle('reject', failure);
  }

  worker.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') fail(new Error('Кодировщик вернул неверный ответ.'));
    else if (data.error) fail(new Error(data.error));
    else settle('resolve', data.buffer);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail(new Error('Сбой кодировщика GIF.'));
  };
  worker.onmessageerror = () => fail(new Error('Не удалось получить данные от кодировщика GIF.'));
  const onAbort = () => fail(new DOMException('Экспорт отменён', 'AbortError'));
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    send(message, transfer = []) {
      signal.throwIfAborted();
      if (failure) return Promise.reject(failure);
      if (pending) return Promise.reject(new Error('Кодировщик ещё обрабатывает предыдущий кадр.'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error('Кодировщик не ответил. Попробуйте уменьшить размер кадра или длину клипа.'));
        }, timeout);
        pending = { resolve, reject, timer };
        try { worker.postMessage(message, transfer); } catch (error) { fail(error); }
      });
    },
    close() {
      signal.removeEventListener('abort', onAbort);
      fail(new Error('Кодировщик закрыт.'));
      worker.terminate();
    },
  };
}

export function asGifBlob(buffer) {
  if (buffer instanceof ArrayBuffer && buffer.byteLength > 13) {
    const bytes = new Uint8Array(buffer);
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    if ((header === 'GIF89a' || header === 'GIF87a') && bytes.at(-1) === 0x3b) {
      return new Blob([buffer], { type: 'image/gif' });
    }
  }
  throw new Error('Кодировщик не вернул готовый GIF-файл.');
}
