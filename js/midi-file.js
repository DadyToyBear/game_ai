/* Экспорт партий проекта в Standard MIDI File (SMF type 1).
   Один трек на каждую машину — такой файл открывает любой DAW,
   а в нём уже можно назначить инструмент Nexus (или любой VST).
   Каждая дорожка получает своё MIDI-назначение (MIDI channel 1..16),
   а машины, у которых есть несколько паттернов (A–D), раскладываются
   по сценам так же, как это делает транспорт. */
(function () {
  'use strict';

  const M = {};

  function vlq(n) {
    // variable-length quantity
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) {
      bytes.unshift((n & 0x7f) | 0x80);
      n >>= 7;
    }
    return bytes;
  }

  /* Строковые поля (имена треков) — UTF-8, байты как есть */
  function utf8(s) {
    if (window.TextEncoder) return Array.from(new TextEncoder().encode(String(s)));
    return Array.from(String(s)).map((c) => c.charCodeAt(0) & 0xff);
  }

  /* Идентификаторы чанков — только ASCII */
  function ascii(s) {
    return Array.from(s).map((c) => c.charCodeAt(0));
  }

  function chunk(id, bytes) {
    const len = bytes.length;
    return ascii(id).concat([(len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255], bytes);
  }

  /* song: объект проекта (см. app.js), events: [{channel,midi,time,duration,velocity}]
     time/duration в секундах. bpm — темп проекта. */
  M.build = function (song, events, opts) {
    opts = opts || {};
    const bpm = song.bpm || 120;
    const ticksPerBeat = opts.ppq || 480;
    const secPerTick = 60 / bpm / ticksPerBeat;

    const toTick = (sec) => Math.max(0, Math.round(sec / secPerTick));

    // заголовок
    const header = chunk('MThd', [
      0, 1,                                  // format 1 (мультитрек)
      (song.tracks.length >> 8) & 255, song.tracks.length & 255,
      (ticksPerBeat >> 8) & 255, ticksPerBeat & 255,
    ]);

    /* Канал MIDI на дорожку. Канал 10 (индекс 9) занят ударными, поэтому
       мелодические машины раскладываем по остальным 15 каналам: иначе при
       17+ дорожках две партии садились на один канал и в DAW звучали одной
       машиной (ноты «съедали» друг друга). */
    let melodySlot = 0;
    const trackChunks = song.tracks.map((tr, ti) => {
      const name = tr.name || ('Track ' + (ti + 1));
      let chan = 0;
      if (tr.engine === 'beatbox') {
        chan = 9;
      } else {
        chan = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15][melodySlot % 15];
        melodySlot++;
      }

      // события дорожки (пары note-on / note-off с одинаковым каналом и высотой)
      const GM = [36, 38, 42, 46, 39, 45, 47, 37]; // GM-карта для драм-машины
      const evs = [];
      events.filter((e) => e.channel === ti).forEach((e) => {
        const isDrum = tr.engine === 'beatbox';
        const midi = isDrum ? (GM[e.midi] != null ? GM[e.midi] : 36) : e.midi;
        const ch = isDrum ? 9 : chan; // 10-й канал MIDI = ударные
        const vel = Math.max(1, Math.round((e.velocity != null ? e.velocity : 0.85) * 127));
        evs.push({ tick: toTick(e.time), kind: 'on', midi: midi, vel: vel, ch: ch });
        evs.push({ tick: toTick(e.time + Math.max(0.02, e.duration)), kind: 'off', midi: midi, vel: 0, ch: ch });
      });
      evs.sort((a, b) => (a.tick - b.tick) || (a.kind === 'off' ? -1 : 1));

      const bytes = [];
      // имя трека (UTF-8, длина — в байтах с VLQ)
      const nameBytes = utf8(name);
      bytes.push(0x00, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
      // программный номер (по умолчанию 0 — назначьте в DAW / Nexus)
      bytes.push(0x00, 0xc0 | chan, opts.program != null ? opts.program : 0);

      let last = 0;
      evs.forEach((e) => {
        const delta = e.tick - last;
        last = e.tick;
        bytes.push(...vlq(delta));
        bytes.push(e.kind === 'on' ? (0x90 | e.ch) : (0x80 | e.ch), e.midi & 127, e.vel & 127);
      });
      // конец трека
      bytes.push(0x00, 0xff, 0x2f, 0x00);
      return chunk('MTrk', bytes);
    });

    const all = [].concat(header);
    trackChunks.forEach((c) => all.push(...c));
    return new Uint8Array(all);
  };

  /* Собирает события из проекта с учётом сцен и паттернов.
     Возвращает [{channel, midi, time, duration, velocity}] */
  M.eventsFromSong = function (song, Pattern, bars) {
    const out = [];
    const stepDur = 60 / (song.bpm || 120) / 4;
    const spb = song.steps || 16;
    const arr = bars != null ? bars : (song.arrangeBars || 4);
    let time = 0;
    for (let bar = 0; bar < arr; bar++) {
      for (let s = 0; s < spb; s++) {
        const patBar = bar % Math.max(1, song.bars || 1);
        const patStep = patBar * spb + s;
        song.tracks.forEach((tr, ci) => {
          if (tr.mute) return;
          const letter = (tr.scenes || 'A').charAt(bar) || 'A';
          const idx = 'ABCD'.indexOf(letter);
          const pat = Pattern.pattern(tr, idx < 0 ? 0 : idx);
          if (tr.engine === 'beatbox') {
            (pat.pads || []).forEach((e) => {
              if (e.at !== patStep) return;
              out.push({ channel: ci, midi: e.p, time, duration: stepDur, velocity: 0.95 });
            });
          } else {
            (pat.notes || []).forEach((n) => {
              if (n.at !== patStep) return;
              out.push({
                channel: ci, midi: n.m, time,
                duration: stepDur * Math.max(1, Pattern.notelen(n)) * 0.95,
                velocity: n.v != null ? n.v : 0.85,
              });
            });
          }
        });
        time += stepDur;
      }
    }
    return out;
  };

  window.MidiFile = M;
})();
