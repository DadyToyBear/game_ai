/* Mini Studio — упаковка проекта в ZIP вместе со своими сэмплами.
   ZIP собирается и читается прямо в браузере: записи без сжатия (store),
   сжатые записи (deflate) читаются через встроенный DecompressionStream.
   Аудио внутри архива — WAV 16 бит, чтобы открывалось любым архиватором. */
(function () {
  'use strict';

  const PIO = {};

  // ---------- CRC32 ----------
  let crcTable = null;
  function makeCrcTable() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  }
  PIO.crc32 = function (bytes) {
    if (!crcTable) crcTable = makeCrcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  // ---------- deflate (сжатие для текстовых файлов) ----------
  /* bytes → Promise<Uint8Array> ; при отсутствии CompressionStream вернёт исходные байты */
  PIO.deflateRaw = function (bytes) {
    if (typeof window.CompressionStream !== 'function') return Promise.resolve(bytes);
    try {
      const cs = new window.CompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Response(stream).arrayBuffer()
        .then((ab) => new Uint8Array(ab))
        .catch(() => bytes);
    } catch (e) { return Promise.resolve(bytes); }
  };

  // ---------- запись ZIP ----------
  function dosDateTime(d) {
    d = d || new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
    };
  }

  function strBytes(s) {
    if (window.TextEncoder) return new window.TextEncoder().encode(s);
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return new Uint8Array(out);
  }

  /* files: [{ name, bytes: Uint8Array, date?: Date, deflate?: bool }] → Blob(application/zip) */
  PIO.buildZip = function (files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const now = new Date();

    files.forEach((f) => {
      const nameBytes = strBytes(f.name);
      const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      // CRC и размер считаются по НЕсжатым данным (так требует формат ZIP)
      const crc = f.crc != null ? f.crc : PIO.crc32(data);
      const plainSize = f.size != null ? f.size : data.length;
      const { time, date } = dosDateTime(f.date || now);

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0x0800, true);      // UTF-8 имена
      lv.setUint16(8, f.method || 0, true);           // 0 = store, 8 = deflate
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);        // сжатый размер
      lv.setUint32(22, plainSize, true);          // исходный размер
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      locals.push(lh, data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);          // version made by
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, f.method || 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);        // сжатый размер
      cv.setUint32(24, plainSize, true);          // исходный размер
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centrals.push(ch);

      offset += lh.length + data.length;
    });

    const cdSize = centrals.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(locals.concat(centrals, [eocd]), { type: 'application/zip' });
  };

  /* files: [{ name, bytes, date?, compress? }] → Promise<Blob>
     compress: true — сжать deflate (для текстовых файлов), аудио не сжимаем. */
  PIO.packFiles = function (files) {
    return Promise.all(files.map((f) => {
      const raw = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      const crc = PIO.crc32(raw);
      const plain = { name: f.name, bytes: raw, method: 0, date: f.date, crc, size: raw.length };
      if (!f.compress) return plain;
      return PIO.deflateRaw(raw).then((packed) => {
        if (!packed || packed.length >= raw.length) return plain;
        return { name: f.name, bytes: packed, method: 8, date: f.date, crc, size: raw.length };
      });
    })).then((prepared) => PIO.buildZip(prepared));
  };

  // ---------- чтение ZIP ----------
  function inflateRaw(bytes) {
    if (typeof window.DecompressionStream !== 'function') {
      return Promise.reject(new Error('Браузер не умеет распаковывать deflate — пересохраните архив без сжатия'));
    }
    const ds = new window.DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then((ab) => new Uint8Array(ab));
  }

  /* arrayBuffer → Promise<[{ name, bytes }]> ; имена декодируются как UTF-8 */
  PIO.readZip = function (arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    const dec = (() => {
      try { return new window.TextDecoder('utf-8'); } catch (e) { return null; }
    })();

    // ищем EOCD с конца (комментарий ≤ 65535 байт)
    let eocd = -1;
    const minPos = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Это не ZIP-архив (нет заголовка EOCD)'));

    const total = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    let p = cdOffset;
    const entries = [];
    for (let i = 0; i < total; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const relOffset = view.getUint32(p + 42, true);
      const nameBytes = u8.subarray(p + 46, p + 46 + nameLen);
      const name = dec ? dec.decode(nameBytes) : String.fromCharCode.apply(null, nameBytes);
      entries.push({ name, method, compSize, relOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    const jobs = entries.map((e) => {
      if (e.name.endsWith('/')) return Promise.resolve({ name: e.name, bytes: new Uint8Array(0) });
      if (view.getUint32(e.relOffset, true) !== 0x04034b50) {
        return Promise.reject(new Error('Повреждённая запись архива: ' + e.name));
      }
      const nLen = view.getUint16(e.relOffset + 26, true);
      const xLen = view.getUint16(e.relOffset + 28, true);
      const start = e.relOffset + 30 + nLen + xLen;
      const raw = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return Promise.resolve({ name: e.name, bytes: raw });
      if (e.method === 8) return inflateRaw(raw).then((bytes) => ({ name: e.name, bytes }));
      return Promise.reject(new Error('Неподдерживаемый метод сжатия: ' + e.method + ' (' + e.name + ')'));
    });
    return Promise.all(jobs);
  };

  // ---------- аудио ↔ WAV ----------
  /* src: AudioBuffer или { channels: Float32Array[], sampleRate } */
  function channelsOf(src) {
    if (!src) return null;
    if (Array.isArray(src.channels)) return { chans: src.channels, sr: src.sampleRate || 44100 };
    if (src.getChannelData) {
      const chans = [];
      for (let c = 0; c < src.numberOfChannels; c++) chans.push(src.getChannelData(c));
      return { chans, sr: src.sampleRate };
    }
    return null;
  }
  PIO.channelsOf = channelsOf;

  function resampleMono(ch, fromSr, toSr) {
    const ratio = toSr / fromSr;
    const len = Math.max(1, Math.round(ch.length * ratio));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i / ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(ch.length - 1, i0 + 1);
      const f = pos - i0;
      out[i] = ch[i0] * (1 - f) + ch[i1] * f;
    }
    return out;
  }

  /* → Uint8Array с WAV 16 бит. opts: { mono, sampleRate } */
  PIO.audioToWav = function (src, opts) {
    opts = opts || {};
    const got = channelsOf(src);
    if (!got) throw new Error('Нет аудиоданных');
    let chans = got.chans;
    let sr = got.sr;
    if (opts.mono && chans.length > 1) {
      const len = chans[0].length;
      const mono = new Float32Array(len);
      for (let c = 0; c < chans.length; c++) {
        const d = chans[c];
        for (let i = 0; i < len; i++) mono[i] += d[i] / chans.length;
      }
      chans = [mono];
    }
    if (opts.sampleRate && opts.sampleRate !== sr) {
      const monoMix = chans.length > 1 ? (() => {
        const len = chans[0].length;
        const m = new Float32Array(len);
        chans.forEach((d) => { for (let i = 0; i < len; i++) m[i] += d[i] / chans.length; });
        return m;
      })() : chans[0];
      chans = [resampleMono(monoMix, sr, opts.sampleRate)];
      sr = opts.sampleRate;
    }
    const numCh = chans.length;
    const len = chans[0].length;
    const ab = new ArrayBuffer(44 + len * numCh * 2);
    const view = new DataView(ab);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); view.setUint32(4, 36 + len * numCh * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * numCh * 2, true);
    view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
    wstr(36, 'data'); view.setUint32(40, len * numCh * 2, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = chans[c][i];
        s = s < -1 ? -1 : (s > 1 ? 1 : s);
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Uint8Array(ab);
  };

  PIO.bytesToAudioBuffer = function (ctx, bytes) {
    const copy = bytes.slice ? bytes.slice() : new Uint8Array(bytes);
    return ctx.decodeAudioData(copy.buffer);
  };

  PIO.sanitizeName = function (name, fallback) {
    const base = String(name || fallback || 'sample')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60);
    return base || 'sample';
  };

  /* Имя файла, совместимое со всеми архиваторами: только ASCII */
  PIO.asciiName = function (name, fallback) {
    const map = { а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
      к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h',
      ц:'c', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya' };
    const s = String(name || '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const low = ch.toLowerCase();
      if (map[low] != null) out += map[low];
      else if (/[A-Za-z0-9._-]/.test(ch)) out += ch;
      else out += '_';
    }
    out = out.replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
    return out || fallback || 'sample';
  };

  window.ProjectIO = PIO;
})();
