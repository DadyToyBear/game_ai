/* Mini Studio — кодировщик MP3 (LAME, чистый JS) и утилиты аудио-экспорта.
   LAME сжат в vendor/lame.min.js (отдельный файл, LGPL) — грузится по требованию,
   только когда пользователь действительно жмёт «Экспорт MP3». */
(function () {
  'use strict';

  const MP3 = {};

  MP3.VENDOR_URL = 'vendor/lame.min.js';
  let loading = null;

  /* Ленивая загрузка LAME: один раз, с кэшем промиса */
  MP3.load = function () {
    if (window.lamejs) return Promise.resolve(window.lamejs);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MP3.VENDOR_URL;
      s.async = true;
      s.onload = () => (window.lamejs ? resolve(window.lamejs)
        : reject(new Error('lame.min.js загрузился, но lamejs не определён')));
      s.onerror = () => reject(new Error('Не удалось загрузить кодировщик MP3 (vendor/lame.min.js)'));
      document.head.appendChild(s);
    });
    loading.catch(() => { loading = null; });
    return loading;
  };

  MP3.available = function () { return !!window.lamejs; };

  function toInt16(channelData) {
    const n = channelData.length;
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      let s = channelData[i];
      s = s < -1 ? -1 : (s > 1 ? 1 : s);
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  /* AudioBuffer → Blob(MP3). kbps: 96/128/192/256/320.
     onProgress(0..1) вызывается по ходу, чтобы показать прогресс-бар. */
  MP3.encodeBuffer = function (buffer, opts) {
    opts = opts || {};
    const kbps = opts.kbps || 192;
    const onProgress = opts.onProgress || function () {};
    return MP3.load().then(() => {
      const channels = Math.min(2, buffer.numberOfChannels);
      const left = toInt16(buffer.getChannelData(0));
      const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;
      const enc = new window.lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);
      const block = 1152 * 24;           // ~0.6 с на блок — хватает прогресса и памяти
      const chunks = [];
      let done = 0;
      const pump = () => {
        const end = Math.min(left.length, done + block);
        let part;
        if (channels > 1) {
          part = enc.encodeBuffer(left.subarray(done, end), right.subarray(done, end));
        } else {
          part = enc.encodeBuffer(left.subarray(done, end));
        }
        if (part.length) chunks.push(part);
        done = end;
        onProgress(done / left.length);
        if (done < left.length) {
          // отдаём поток браузеру, чтобы UI не подвисал на длинных рендерах
          return new Promise((r) => setTimeout(r, 0)).then(pump);
        }
        const tail = enc.flush();
        if (tail.length) chunks.push(tail);
        onProgress(1);
        return new Blob(chunks, { type: 'audio/mpeg' });
      };
      return Promise.resolve().then(pump);
    });
  };

  /* WAV → Blob (16 бит PCM). Используется в экспорте и в разделе сохранений. */
  MP3.encodeWav = function (buffer) {
    if (window.AudioEngine && window.AudioEngine.encodeWav) return window.AudioEngine.encodeWav(buffer);
    throw new Error('Нет AudioEngine.encodeWav');
  };

  MP3.duration = function (buffer) {
    return buffer ? buffer.length / buffer.sampleRate : 0;
  };

  window.ExportMp3 = MP3;
})();
