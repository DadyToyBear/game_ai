/* Kaoss-модули (в духе Korg mini Kaoss Pad 2 и Kaossilator 2):
   - Kaossilator: X-Y пэд-синтезатор со сквозным глиссандо и двумя лупами
   - KaossPad: X-Y процессор эффектов на мастер-шине (12 программ)
   Всё на Web Audio, без внешних зависимостей. */
(function () {
  'use strict';

  const K = {};
  /* AudioEngine грузится позже — обращаемся лениво */
  const AE = () => window.AudioEngine;
  const newVoice = (...a) => new (window.AudioEngine.Voice)(...a);

  // ---------- утилиты ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
  const expMap = (min, max, t) => min * Math.pow(max / min, clamp(t, 0, 1));

  // ---------- Банк звуков Kaossilator (категории как на железе) ----------
  /* prog: {name, cat, engine, params, scale?, octave?, drum?}
     params — базовые значения; Y подмешивает яркость поверх. */
  const PROGRAMS = [
    // --- БАСЫ ---
    { name: 'Sub Bass', cat: 'bass', engine: 'bassline', octave: 2,
      params: { wave: 'square', cutoff: 160, res: 4, env: 600, decay: 0.45, accent: 0.3, slide: 0.1, drive: 0.12, level: 0.75 } },
    { name: 'Acid 303', cat: 'bass', engine: 'bassline', octave: 2,
      params: { wave: 'sawtooth', cutoff: 300, res: 20, env: 3200, decay: 0.18, accent: 0.75, slide: 0.2, drive: 0.3, level: 0.6 } },
    { name: 'Reese Bass', cat: 'bass', engine: 'subsynth', octave: 2,
      params: { wave: 'sawtooth', detune: 22, sub: 0.5, cutoff: 420, res: 6, env: 900, a: 0.005, d: 0.5, s: 0.7, r: 0.2, level: 0.6 } },
    { name: 'FM Bass', cat: 'bass', engine: 'fmsynth', octave: 2,
      params: { ratio: 1, index: 4, ratio2: 2, index2: 0.4, decay: 0.2, wave: 'sine', a: 0.003, d: 0.22, s: 0.3, r: 0.12, level: 0.6 } },

    // --- ЛИДЫ / МЕЛОДИИ ---
    { name: 'Saw Lead', cat: 'lead', engine: 'subsynth', octave: 4,
      params: { wave: 'sawtooth', detune: 12, sub: 0.15, cutoff: 2600, res: 5, env: 3200, a: 0.008, d: 0.3, s: 0.7, r: 0.25, level: 0.5 } },
    { name: 'Square Lead', cat: 'lead', engine: 'subsynth', octave: 4,
      params: { wave: 'square', detune: 4, sub: 0.1, cutoff: 3200, res: 3, env: 1800, a: 0.005, d: 0.25, s: 0.6, r: 0.2, level: 0.45 } },
    { name: 'Chip Lead', cat: 'lead', engine: 'eightbit', octave: 4,
      params: { duty: 0.25, vibrato: 0.3, pitchEnv: 0, bits: 8, a: 0.002, d: 0.2, s: 0.6, r: 0.1, level: 0.4 } },
    { name: 'FM Bell Lead', cat: 'lead', engine: 'fmsynth', octave: 4,
      params: { ratio: 3.5, index: 4.5, ratio2: 7, index2: 1.2, decay: 1.1, wave: 'sine', a: 0.002, d: 1.2, s: 0.2, r: 0.7, level: 0.45 } },

    // --- СИНТЫ / ПЛАКИ ---
    { name: 'Pluck', cat: 'pluck', engine: 'subsynth', octave: 4,
      params: { wave: 'sawtooth', detune: 14, sub: 0.2, cutoff: 900, res: 12, env: 4200, a: 0.002, d: 0.14, s: 0.05, r: 0.12, level: 0.5 } },
    { name: 'Glass Pluck', cat: 'pluck', engine: 'fmsynth', octave: 5,
      params: { ratio: 2, index: 2.4, ratio2: 5, index2: 0.8, decay: 0.5, wave: 'sine', a: 0.002, d: 0.5, s: 0.1, r: 0.4, level: 0.4 } },
    { name: 'Marimba', cat: 'pluck', engine: 'fmsynth', octave: 5,
      params: { ratio: 4, index: 1.6, ratio2: 9, index2: 0.3, decay: 0.16, wave: 'sine', a: 0.001, d: 0.18, s: 0, r: 0.14, level: 0.5 } },

    // --- ПЭДЫ / СТРУННЫЕ ---
    { name: 'Warm Pad', cat: 'pad', engine: 'padsynth', octave: 4,
      params: { voices: 4, spread: 18, cutoff: 1600, res: 1.5, a: 0.9, d: 1.5, s: 0.85, r: 2, level: 0.32 } },
    { name: 'Glass Pad', cat: 'pad', engine: 'padsynth', octave: 4,
      params: { voices: 5, spread: 40, cutoff: 6000, res: 4, a: 0.4, d: 1, s: 0.7, r: 3, level: 0.25 } },
    { name: 'Strings', cat: 'pad', engine: 'padsynth', octave: 4,
      params: { voices: 6, spread: 26, cutoff: 3200, res: 1, a: 0.25, d: 0.8, s: 0.9, r: 1.2, level: 0.3 } },

    // --- ЧИПТЮН ---
    { name: '8Bit Bass', cat: 'chip', engine: 'eightbit', octave: 2,
      params: { duty: 0.5, vibrato: 0, bits: 4, a: 0.002, d: 0.15, s: 0.4, r: 0.08, level: 0.5 } },
    { name: '8Bit Arp', cat: 'chip', engine: 'eightbit', octave: 5,
      params: { duty: 0.125, vibrato: 0.1, pitchEnv: 0, bits: 6, a: 0.001, d: 0.1, s: 0.2, r: 0.06, level: 0.4 } },

    // --- УДАРНЫЕ (X = тип удара, Y = яркость) ---
    { name: 'Drum Kit', cat: 'drum', drum: true, octave: 0 },
    { name: 'Toms', cat: 'drum', drum: true, pads: [5, 5, 6, 6, 0, 7] },
    { name: 'Hats & Claps', cat: 'drum', drum: true, pads: [2, 3, 3, 2, 4, 4] },

    // --- БАСОВЫЕ ЛУПЫ (паттерны в одном тембре) ---
    { name: 'Bass Loop A', cat: 'loopbass', engine: 'bassline', octave: 2,
      loop: { steps: 16, pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0] },
      params: { wave: 'sawtooth', cutoff: 280, res: 16, env: 2600, decay: 0.2, accent: 0.6, slide: 0.15, drive: 0.25, level: 0.6 } },
    { name: 'Bass Loop B', cat: 'loopbass', engine: 'subsynth', octave: 2,
      loop: { steps: 16, pattern: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1] },
      params: { wave: 'square', detune: 8, sub: 0.5, cutoff: 380, res: 8, env: 1200, a: 0.004, d: 0.3, s: 0.5, r: 0.15, level: 0.55 } },

    // --- МЕЛОДИЧЕСКИЕ ЛУПЫ / АРПЕДЖИО ---
    { name: 'Arp Loop', cat: 'loopmel', engine: 'subsynth', octave: 4,
      loop: { steps: 16, pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
      params: { wave: 'sawtooth', detune: 8, sub: 0.15, cutoff: 2200, res: 8, env: 2600, a: 0.002, d: 0.12, s: 0.2, r: 0.08, level: 0.45 } },
    { name: 'Chip Arp', cat: 'loopmel', engine: 'eightbit', octave: 5,
      loop: { steps: 16, pattern: [1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1] },
      params: { duty: 0.25, vibrato: 0.05, bits: 6, a: 0.001, d: 0.1, s: 0.15, r: 0.06, level: 0.35 } },

    // --- ДРАМ-ЛУП (встроенный паттерн BeatBox) ---
    { name: 'Drum Loop (4/4)', cat: 'loopdrum', drum: true, octave: 0,
      loop: {
        steps: 16,
        drum: {
          0: [0, 8],      // kick
          1: [4, 12],     // snare
          2: [0, 2, 4, 6, 8, 10, 12, 14], // closed hat
          3: [6, 14],     // open hat
        },
      } },
    { name: 'Drum Loop Break', cat: 'loopdrum', drum: true, octave: 0,
      loop: {
        steps: 16,
        drum: {
          0: [0, 3, 8, 10],
          1: [4, 12],
          2: [0, 2, 6, 8, 10, 14],
          4: [7, 15],
          7: [5, 13],
        },
      } },
  ];

  const CAT_NAMES = {
    bass: 'Басы', lead: 'Лиды', pluck: 'Синты/плаки', pad: 'Пэды',
    chip: 'Чиптюн', drum: 'Ударные', loopbass: 'Басовые лупы',
    loopmel: 'Мелодические лупы', loopdrum: 'Драм-лупы',
  };

  // ---------- Kaossilator: X-Y синтезатор ----------
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    penta: [0, 2, 4, 7, 9],
    pentaMin: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  const WAVES = ['sawtooth', 'square', 'triangle', 'sine'];

  /* Запись сегмента фразы (общая для синтеза и сэмплера) */
  function recordSegment(inst, x, y, velocity, midi) {
    if (inst.recSlot < 0) return;
    const now = inst.ctx.currentTime - inst.recStart;
    if (inst.recSegs.length) {
      const last = inst.recSegs[inst.recSegs.length - 1];
      if (last.t1 == null) last.t1 = now;
    }
    inst.recSegs.push({ t0: now, t1: null, midi, x, y, v: velocity != null ? velocity : 0.9, mode: inst.mode });
  }

  /* Инструмент: возвращает объект с методами для UI и лупером */
  K.createInstrument = function (ctx, dest) {
    const out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(dest);

    const inst = {
      ctx,
      out,
      octave: 4,
      scale: 'pentaMin',
      wave: 'sawtooth',
      glide: 0.35,
      loopBars: 1,
      bpm: 120,
      loops: [null, null],       // записанные фразы: [{t0,t1,midi,y,v}]
      recSlot: -1,
      recStart: 0,
      recSegs: [],
      playingLoops: [false, false],
      loopTimers: [null, null],
      voice: null,
      prog: 0,             // индекс программы из банка
      sampler: null,       // сэмплер слайсов (создаётся при загрузке)
      mode: 'synth',       // 'synth' | 'sampler'
      lastMidi: null,
      midi: 60,
      y: 0.5,
    };

    /* Параметры текущей программы: базовый тембр + Y как «яркость» */
    function paramsFor(inst2, y) {
      const bright = clamp(y != null ? y : 0.5, 0, 1);
      const prog = PROGRAMS[inst2.prog] || PROGRAMS[0];
      const base = prog.params ? Object.assign({}, prog.params) : {
        wave: 'sawtooth', detune: 6, sub: 0.4, cutoff: 1800, res: 7, env: 2400,
        a: 0.004, d: 0.18, s: 0.55, r: 0.18, level: 0.5,
      };
      // Y подмешивает яркость: срез и env едут к «открытому» звуку
      if (base.cutoff != null) {
        const baseCut = base.cutoff;
        base.cutoff = baseCut * Math.pow(3.2, bright * 1.4 - 0.6);
        base.cutoff = clamp(base.cutoff, 60, 16000);
      }
      if (base.env != null) base.env = base.env * (0.35 + bright * 1.5);
      if (base.res != null) base.res = clamp(base.res * (1.35 - bright * 0.5), 0.1, 26);
      return base;
    }

    /* X (0..1) → нота по гамме, Y (0..1) → яркость/срез */
    inst.quantize = function (x) {
      const prog = PROGRAMS[inst.prog] || PROGRAMS[0];
      const octave = prog.octave != null ? prog.octave : inst.octave;
      const sc = SCALES[inst.scale] || SCALES.chromatic;
      const total = sc.length;
      const idx = Math.round(x * (total * 2 - 1));
      const oct = Math.floor(idx / total);
      const deg = ((idx % total) + total) % total;
      return 12 * (octave + oct) + sc[deg];
    };

    inst.noteOn = function (x, y, velocity) {
      inst.x = x;
      inst.y = y;
      const prog = PROGRAMS[inst.prog] || PROGRAMS[0];

      // режим слайсов из своих сэмплов
      if (inst.mode === 'sampler' && inst.sampler) {
        inst.sampler.play(x, y, velocity, null);
        inst.midi = inst.quantize(x);
        recordSegment(inst, x, y, velocity, inst.midi);
        return inst.midi;
      }

      // ударные программы: X выбирает тип удара
      if (prog.drum) {
        const pads = prog.pads || [0, 1, 2, 3, 4, 5, 6, 7];
        const idx = Math.min(pads.length - 1, Math.max(0, Math.floor(x * pads.length)));
        const pad = pads[idx];
        AE().playDrum(ctx, out, { tune: 0, decay: 0.9 + y * 0.8, snap: 0.5, level: 0.9 }, pad, ctx.currentTime, velocity != null ? velocity : 0.95, null);
        inst.midi = pad;
        recordSegment(inst, x, y, velocity, pad);
        return pad;
      }

      const midi = inst.quantize(x);
      inst.midi = midi;
      if (inst.voice && inst.lastMidi === midi) {
        inst.voice.setParam('cutoff', expMap(220, 11000, y));
        return midi;
      }
      if (inst.voice) inst.voice.kill(ctx.currentTime);
      const p = paramsFor(inst, y);
      inst.voice = newVoice(ctx, out, prog.engine || 'subsynth', p, midi, velocity != null ? velocity : 0.9, ctx.currentTime);
      inst.lastMidi = midi;
      recordSegment(inst, x, y, velocity, midi);
      return midi;
    };

    inst.move = function (x, y) {
      inst.x = x;
      inst.y = y;
      const midi = inst.quantize(x);
      if (inst.voice) {
        inst.voice.setParam('cutoff', expMap(220, 11000, y));
      }
      if (midi !== inst.lastMidi) return inst.noteOn(x, y, 0.9);
      return midi;
    };

    inst.noteOff = function (force) {
      if (inst.hold && !force) return; // нота держится
      if (inst.voice) {
        inst.voice.release(ctx.currentTime);
        inst.voice = null;
      }
      inst.lastMidi = null;
      if (inst.recSlot >= 0 && inst.recSegs.length) {
        const last = inst.recSegs[inst.recSegs.length - 1];
        if (last.t1 == null) last.t1 = ctx.currentTime - inst.recStart;
      }
    };

    inst.loopLength = function () {
      return (60 / inst.bpm) * 4 * inst.loopBars;
    };

    /* --- лупер --- */
    inst.startRec = function (slot) {
      inst.recSlot = slot;
      inst.recSegs = [];
      inst.recStart = ctx.currentTime;
      inst.stopLoop(slot);
      inst.loops[slot] = null;
    };

    inst.stopRec = function () {
      if (inst.recSlot < 0) return null;
      const slot = inst.recSlot;
      inst.recSlot = -1;
      const segs = inst.recSegs.filter((s) => s.t1 != null || true).map((s) => ({
        t0: s.t0,
        t1: s.t1 != null ? s.t1 : s.t0 + 0.12,
        midi: s.midi,
        y: s.y,
        v: s.v,
      }));
      inst.recSegs = [];
      if (!segs.length) return null;
      inst.loops[slot] = segs;
      inst.startLoop(slot);
      return slot;
    };

    inst.clearLoop = function (slot) {
      inst.stopLoop(slot);
      inst.loops[slot] = null;
      if (inst.recSlot === slot) inst.recSlot = -1;
    };

    inst.startLoop = function (slot) {
      inst.stopLoop(slot);
      const segs = inst.loops[slot];
      if (!segs || !segs.length) return;
      inst.playingLoops[slot] = true;
      const len = inst.loopLength();
      const tick = () => {
        if (!inst.playingLoops[slot]) return;
        const t0 = ctx.currentTime + 0.05;
        segs.forEach((s) => {
          const start = t0 + (s.t0 % len);
          const dur = Math.max(0.05, Math.min(s.t1 - s.t0, len));
          const pr = PROGRAMS[inst.prog] || PROGRAMS[0];
          if (s.mode === 'sampler' && inst.sampler && inst.sampler.buffer) {
            // для сэмплерных фраз пересчитываем по X
            const when = Math.max(0, (start - ctx.currentTime) * 1000);
            const limit = (s.t1 - s.t0) > 0.02 ? dur : null;
            setTimeout(() => { if (inst.playingLoops[slot]) inst.sampler.play(s.x, s.y, s.v, limit); }, when);
          } else if (pr.drum) {
            const whenPad = Math.max(0, (start - ctx.currentTime) * 1000);
            setTimeout(() => {
              if (inst.playingLoops[slot]) {
                AE().playDrum(ctx, out, { tune: 0, decay: 0.9 + (s.y || 0.5) * 0.8, snap: 0.5, level: 0.9 }, s.midi, ctx.currentTime, s.v, null);
              }
            }, whenPad);
          } else {
            window.AudioEngine.playNote(ctx, out, pr.engine || 'subsynth', paramsFor(inst, s.y), s.midi, s.v, start, dur);
          }
        });
        inst.loopTimers[slot] = setTimeout(tick, len * 1000);
      };
      tick();
    };

    /* Смена темпа: уже играющие лупы считались по старому шагу, и они
       расходились с транспортом. Перезапускаем их на новом темпе. */
    inst.setBpm = function (bpm) {
      const v = Math.max(30, Math.min(300, Number(bpm) || 120));
      if (v === inst.bpm) return inst.bpm;
      inst.bpm = v;
      [0, 1].forEach((slot) => {
        if (inst.playingLoops[slot]) {
          const wasProgram = inst.loopTimers[slot] != null;
          inst.stopLoop(slot);
          inst.playingLoops[slot] = true;
          inst.startLoop(slot);
          if (wasProgram && inst.startProgramLoop) { /* программный луп заводится отдельно */ }
        }
      });
      return inst.bpm;
    };

    inst.stopLoop = function (slot) {
      inst.playingLoops[slot] = false;
      if (inst.loopTimers[slot]) { clearTimeout(inst.loopTimers[slot]); inst.loopTimers[slot] = null; }
    };

    /* Загрузка своих сэмплов: WAV/MP3/OGG → слайсы на пэде */
    inst.ensureSampler = function () {
      if (!inst.sampler) inst.sampler = K.createSampler(ctx, out);
      return inst.sampler;
    };

    inst.loadSample = function (buffer, name) {
      inst.ensureSampler().load(buffer, name);
      inst.mode = 'sampler';
      return inst.sampler;
    };

    inst.setProgram = function (i) {
      inst.prog = Math.max(0, Math.min(PROGRAMS.length - 1, i));
      const pr = PROGRAMS[inst.prog];
      if (pr.octave != null) inst.octave = pr.octave;
      inst.lastMidi = null;
      if (inst.voice) { inst.voice.release(ctx.currentTime); inst.voice = null; }
      return pr;
    };

    inst.setMode = function (mode) {
      inst.mode = mode;
      if (mode === 'sampler') inst.ensureSampler();
    };

    /* HOLD у Kaossilator: нота «залипает» после отпускания пальца */
    inst.hold = false;
    inst.holdMidi = null;

    inst.setHold = function (on) {
      inst.hold = !!on;
      if (inst.hold) {
        inst.holdMidi = inst.lastMidi;
      } else {
        inst.holdMidi = null;
        inst.noteOff();
      }
      return inst.hold;
    };

    inst.releaseHold = function () {
      if (!inst.hold) return;
      inst.hold = false;
      inst.holdMidi = null;
      inst.noteOff();
    };

    /* Наличие встроенного лупа у программы */
    inst.programLoop = function () {
      const pr = PROGRAMS[inst.prog];
      return pr && pr.loop ? pr.loop : null;
    };

    /* Проиграть встроенный луп программы (не путать с лупами записи) */
    inst.startProgramLoop = function (slot) {
      const pr = PROGRAMS[inst.prog];
      if (!pr || !pr.loop) return false;
      inst.stopLoop(slot);
      inst.playingLoops[slot] = true;
      const loop = pr.loop;
      let i = 0;
      const tick = () => {
        if (!inst.playingLoops[slot]) return;
        // шаг считаем на каждом тике: иначе смена BPM на ходу не слышна
        const stepMs = (60 / inst.bpm / 4) * 1000;
        const step = loop.steps || 16;
        const x = (i % step) / step;
        if (loop.drum) {
          Object.keys(loop.drum).forEach((pad) => {
            if (loop.drum[pad].indexOf(i % step) >= 0) {
              AE().playDrum(ctx, out, { tune: 0, decay: 1, snap: 0.5, level: 0.9 }, Number(pad), ctx.currentTime, 0.95, null);
            }
          });
        } else if (loop.pattern) {
          if (loop.pattern[i % step]) {
            const midi = inst.quantize(x);
            window.AudioEngine.playNote(ctx, out, pr.engine || 'subsynth', paramsFor(inst, 0.6), midi, 0.9, ctx.currentTime, stepMs / 1000 * 0.9);
          }
        } else if (pr.drum) {
          AE().playDrum(ctx, out, { tune: 0, decay: 1, snap: 0.5, level: 0.9 }, 0, ctx.currentTime, 0.95, null);
        }
        i++;
        inst.loopTimers[slot] = setTimeout(tick, stepMs);
      };
      tick();
      return true;
    };

    inst.stopAll = function () {
      if (inst.sampler) inst.sampler.stopAll();
      inst.noteOff();
      inst.stopLoop(0); inst.stopLoop(1);
    };

    return inst;
  };

  // ---------- mini Kaoss Pad 2: X-Y процессор эффектов ----------
  /* Граф: input → dry → out
          input → filt → (параллельные посылы) → out
     Программа задаёт, какие посылы включены и как X/Y влияют на параметры. */
  K.createFX = function (ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 20000;
    filt.Q.value = 0.7;
    input.connect(filt);
    filt.connect(dry);
    dry.connect(output);

    const tap = (node, gainVal) => {
      const g = ctx.createGain();
      g.gain.value = gainVal || 0;
      node.connect(g);
      g.connect(output);
      return g;
    };

    // фленджер / хорус
    const flDelay = ctx.createDelay(0.1);
    flDelay.delayTime.value = 0.006;
    const flLfo = ctx.createOscillator();
    flLfo.frequency.value = 0.4;
    const flDepth = ctx.createGain();
    flDepth.gain.value = 0.002;
    flLfo.connect(flDepth); flDepth.connect(flDelay.delayTime);
    flLfo.start();
    filt.connect(flDelay);
    const flWet = tap(flDelay, 0);

    // эхо
    const echo = ctx.createDelay(2);
    echo.delayTime.value = 0.28;
    const echoFb = ctx.createGain();
    echoFb.gain.value = 0.3;
    const echoDamp = ctx.createBiquadFilter();
    echoDamp.type = 'lowpass'; echoDamp.frequency.value = 4000;
    filt.connect(echo);
    echo.connect(echoDamp); echoDamp.connect(echoFb); echoFb.connect(echo);
    const echoWet = tap(echoDamp, 0);

    // дисторшн
    const drive = ctx.createWaveShaper();
    drive.oversample = '2x';
    const driveCurve = (k) => {
      const n = 1024;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      return c;
    };
    drive.curve = driveCurve(6);
    filt.connect(drive);
    const driveWet = tap(drive, 0);

    // бит-крэш
    const crush = ctx.createWaveShaper();
    const crushCurve = (bits) => {
      const n = 2048;
      const steps = Math.pow(2, Math.max(1, bits - 1));
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.round(x * steps) / steps;
      }
      return c;
    };
    crush.curve = crushCurve(12);
    filt.connect(crush);
    const crushWet = tap(crush, 0);

    // реверб
    const conv = ctx.createConvolver();
    conv.buffer = (function () {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * 1.8);
      const buf = ctx.createBuffer(2, len, rate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
      return buf;
    })();
    filt.connect(conv);
    const revWet = tap(conv, 0);
    revWet.gain.value = 0;

    // гейт / тремоло
    const gate = ctx.createGain();
    gate.gain.value = 1;
    const gateLfo = ctx.createOscillator();
    gateLfo.type = 'square';
    gateLfo.frequency.value = 6;
    const gateDepth = ctx.createGain();
    gateDepth.gain.value = 0;
    gateLfo.connect(gateDepth); gateDepth.connect(gate.gain);
    gateLfo.start();
    filt.connect(gate);
    const gateWet = tap(gate, 0);

    // кольцевой модулятор
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const ringOsc = ctx.createOscillator();
    ringOsc.frequency.value = 300;
    const ringDepth = ctx.createGain();
    ringDepth.gain.value = 0;
    ringOsc.connect(ringDepth); ringDepth.connect(ring.gain);
    ringOsc.start();
    filt.connect(ring);
    const ringWet = tap(ring, 0);

    const allWets = [flWet, echoWet, driveWet, crushWet, revWet, gateWet, ringWet];

    const PROGRAMS = [
      {
        name: 'LP Filter', tag: 'filter',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(expMap(90, 16000, x), ctx.currentTime, 0.02);
          filt.Q.setTargetAtTime(0.7 + y * 18, ctx.currentTime, 0.02);
          return { dry: 0, filtCut: true };
        },
      },
      {
        name: 'HP Filter', tag: 'filter',
        apply(x, y) {
          filt.type = 'highpass';
          filt.frequency.setTargetAtTime(expMap(40, 9000, x), ctx.currentTime, 0.02);
          filt.Q.setTargetAtTime(0.7 + y * 14, ctx.currentTime, 0.02);
          return { dry: 0 };
        },
      },
      {
        name: 'BP Sweep', tag: 'filter',
        apply(x, y) {
          filt.type = 'bandpass';
          filt.frequency.setTargetAtTime(expMap(120, 9000, x), ctx.currentTime, 0.02);
          filt.Q.setTargetAtTime(1 + y * 20, ctx.currentTime, 0.02);
          return { dry: 0 };
        },
      },
      {
        name: 'Flanger', tag: 'mod',
        apply(x, y) {
          filt.type = 'allpass';
          filt.frequency.setTargetAtTime(1200, ctx.currentTime, 0.02);
          flLfo.frequency.setTargetAtTime(lerp(0.08, 6, x), ctx.currentTime, 0.03);
          flDepth.gain.setTargetAtTime(lerp(0.0005, 0.006, y), ctx.currentTime, 0.03);
          return { dry: 0.6, flanger: 1 };
        },
      },
      {
        name: 'Chorus', tag: 'mod',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(16000, ctx.currentTime, 0.02);
          flLfo.frequency.setTargetAtTime(lerp(0.15, 2.2, x), ctx.currentTime, 0.03);
          flDepth.gain.setTargetAtTime(lerp(0.001, 0.004, y), ctx.currentTime, 0.03);
          flDelay.delayTime.setTargetAtTime(0.016, ctx.currentTime, 0.03);
          return { dry: 0.85, flanger: 0.9 };
        },
      },
      {
        name: 'Echo', tag: 'delay',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(16000, ctx.currentTime, 0.02);
          echo.delayTime.setTargetAtTime(lerp(0.06, 0.6, x), ctx.currentTime, 0.03);
          echoFb.gain.setTargetAtTime(lerp(0.05, 0.72, y), ctx.currentTime, 0.03);
          return { dry: 0.9, echo: 0.9 };
        },
      },
      {
        name: 'Reverb', tag: 'delay',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(expMap(800, 16000, x), ctx.currentTime, 0.02);
          return { dry: 0.85, rev: lerp(0.25, 1, y) };
        },
      },
      {
        name: 'Vinyl Break', tag: 'lo-fi',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(expMap(300, 9000, 1 - x * 0.85), ctx.currentTime, 0.03);
          crush.curve = crushCurve(Math.round(lerp(10, 3, y)));
          return { dry: 0.25, crush: 0.9 };
        },
      },
      {
        name: 'Gate', tag: 'dynamic',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(16000, ctx.currentTime, 0.02);
          gateLfo.frequency.setTargetAtTime(lerp(0.6, 14, x), ctx.currentTime, 0.03);
          gateDepth.gain.setTargetAtTime(lerp(0.15, 1, y), ctx.currentTime, 0.03);
          return { dry: 0.2, gate: 0.9 };
        },
      },
      {
        name: 'Distortion', tag: 'drive',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(expMap(700, 16000, y), ctx.currentTime, 0.02);
          drive.curve = driveCurve(lerp(2, 60, x));
          return { dry: 0.35, drive: 0.9 };
        },
      },
      {
        name: 'Crush', tag: 'lo-fi',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(expMap(600, 16000, y), ctx.currentTime, 0.02);
          crush.curve = crushCurve(Math.round(lerp(12, 2, x)));
          return { dry: 0.4, crush: 0.9 };
        },
      },
      {
        name: 'Ring Mod', tag: 'mod',
        apply(x, y) {
          filt.type = 'lowpass';
          filt.frequency.setTargetAtTime(16000, ctx.currentTime, 0.02);
          ringOsc.frequency.setTargetAtTime(expMap(30, 3000, x), ctx.currentTime, 0.03);
          ringDepth.gain.setTargetAtTime(lerp(0.2, 1, y), ctx.currentTime, 0.03);
          return { dry: 0.45, ring: 0.9 };
        },
      },
    ];

    /* --- Плеер сэмплов (как MP3-плеер у miniKP2): pitch, speed, слайсы --- */
    const player = {
      buffer: null, name: '', src: null, gain: null,
      playing: false, rate: 1, loop: false,
    };
    const fx = {
      input, output, programs: PROGRAMS, program: 0, player,
      x: 0.5, y: 0.5,
      active: false,
      /* HOLD: фиксация последней позиции X/Y (как кнопка HOLD на miniKP2) */
      hold: false,
      holdX: 0.5,
      holdY: 0.5,
      setHold(on) {
        fx.hold = !!on;
        if (fx.hold) { fx.holdX = fx.x; fx.holdY = fx.y; }
        else { fx.setXY(fx.x, fx.y); }
        return fx.hold;
      },
      /* Плавный «отпуск» — возврат эффекта в нейтраль (как отпускание пэда) */
      releaseXY() {
        if (fx.hold) return;
        const t = ctx.currentTime;
        allWets.forEach((g) => g.gain.setTargetAtTime(0, t, 0.12));
        dry.gain.setTargetAtTime(1, t, 0.12);
        filt.type = 'lowpass';
        filt.frequency.setTargetAtTime(20000, t, 0.15);
        filt.Q.setTargetAtTime(0.7, t, 0.15);
        gateDepth.gain.setTargetAtTime(0, t, 0.15);
        ringDepth.gain.setTargetAtTime(0, t, 0.15);
        fx.active = false;
      },
      setProgram(i) {
        fx.program = clamp(i, 0, PROGRAMS.length - 1);
        fx.setXY(fx.x, fx.y);
      },
      setXY(x, y) {
        fx.x = clamp(x, 0, 1);
        fx.y = clamp(y, 0, 1);
        allWets.forEach((g) => g.gain.setTargetAtTime(0, ctx.currentTime, 0.02));
        const p = PROGRAMS[fx.program];
        const res = p.apply(fx.x, fx.y) || {};
        dry.gain.setTargetAtTime(res.dry != null ? res.dry : 1, ctx.currentTime, 0.02);
        if (res.flanger) flWet.gain.setTargetAtTime(res.flanger, ctx.currentTime, 0.02);
        if (res.echo) echoWet.gain.setTargetAtTime(res.echo, ctx.currentTime, 0.02);
        if (res.drive) driveWet.gain.setTargetAtTime(res.drive, ctx.currentTime, 0.02);
        if (res.crush) crushWet.gain.setTargetAtTime(res.crush, ctx.currentTime, 0.02);
        if (res.rev) revWet.gain.setTargetAtTime(res.rev, ctx.currentTime, 0.02);
        if (res.gate) gateWet.gain.setTargetAtTime(res.gate, ctx.currentTime, 0.02);
        if (res.ring) ringWet.gain.setTargetAtTime(res.ring, ctx.currentTime, 0.02);
        fx.active = true;
      },
      reset() {
        fx.x = 0.5; fx.y = 0.5;
        dry.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
        allWets.forEach((g) => g.gain.setTargetAtTime(0, ctx.currentTime, 0.05));
        filt.type = 'lowpass';
        filt.frequency.setTargetAtTime(20000, ctx.currentTime, 0.05);
        filt.Q.setTargetAtTime(0.7, ctx.currentTime, 0.05);
        gateDepth.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        ringDepth.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        fx.active = false;
      },
      dispose() {
        try { flLfo.stop(); gateLfo.stop(); ringOsc.stop(); } catch (e) {}
      },
    };

    fx.loadAudio = function (buffer, name) {
      player.buffer = buffer;
      player.name = name || '';
      return player;
    };

    fx.playSample = function (rate, loop) {
      if (!player.buffer) return;
      fx.stopSample();
      const src = ctx.createBufferSource();
      src.buffer = player.buffer;
      src.playbackRate.value = rate || player.rate || 1;
      src.loop = loop != null ? loop : player.loop;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g); g.connect(fx.input);
      src.start();
      player.src = src; player.gain = g; player.playing = true;
      src.onended = () => { player.playing = false; };
    };

    fx.stopSample = function () {
      if (player.src) { try { player.src.stop(); } catch (e) {} }
      player.src = null; player.playing = false;
    };

    fx.setPitch = function (semitones) {
      player.rate = Math.pow(2, semitones / 12);
      if (player.src) player.src.playbackRate.setTargetAtTime(player.rate, ctx.currentTime, 0.02);
    };

    fx.setPlayerLoop = function (on) {
      player.loop = !!on;
      if (player.src) player.src.loop = player.loop;
    };

    return fx;
  };

  // ---------- Сэмплер слайсов (WAV/MP3 → слайсы на пэд) ----------
  /* Держит AudioBuffer и раскладку по 8 слайсам. Играет с транспонированием
     по X и фильтром по Y — как сэмплер miniKP2 / Kaossilator. */
  K.createSampler = function (ctx, dest) {
    const root = ctx.createGain();
    root.gain.value = 1;
    root.connect(dest);

    const S = {
      ctx, out: root,
      buffer: null,          // AudioBuffer
      name: '',
      slices: [],            // [{start,end}] — нормализованные позиции 0..1
      sliceMode: true,       // играть слайс под X или весь сэмпл
      xMode: 'slice',        // 'slice' | 'pitch' | 'speed'
      pitchRange: 12,        // полутонов вверх по X
      reverse: false,
      voices: [],
      active: [],
    };

    S.load = function (buffer, name) {
      S.buffer = buffer;
      S.name = name || '';
      S.sliceByGrid(S.slices.length || 8);
      return S;
    };

    /* Равномерная нарезка на n слайсов */
    S.sliceByGrid = function (n) {
      n = Math.max(1, Math.min(64, Math.round(n)));
      const out = [];
      for (let i = 0; i < n; i++) out.push({ start: i / n, end: (i + 1) / n });
      S.slices = out;
      return out;
    };

    /* Ручная нарезка по отметкам (0..1) — например, по битам/транзиентам */
    S.sliceByMarks = function (marks) {
      const pts = marks.slice().sort((a, b) => a - b).filter((v) => v >= 0 && v < 1);
      if (!pts.length) return S.slices;
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        out.push({ start: pts[i], end: i + 1 < pts.length ? pts[i + 1] : 1 });
      }
      S.slices = out;
      return out;
    };

    /* Автонарезка: находим самые громкие локальные пики и режем по ним */
    S.sliceByPeaks = function (count) {
      if (!S.buffer) return [];
      count = Math.max(2, Math.min(32, Math.round(Number(count) || 8)));
      const data = S.buffer.getChannelData(0);
      const len = data.length;
      const win = Math.max(32, Math.floor(len / 2000)); // огибающая
      const env = [];
      for (let i = 0; i < len; i += win) {
        let max = 0;
        for (let j = i; j < Math.min(len, i + win); j++) max = Math.max(max, Math.abs(data[j]));
        env.push(max);
      }
      const flat = env.slice().sort((a, b) => a - b);
      const floor = flat[Math.floor(flat.length * 0.7)] || 0.05;

      // кандидаты: начало звука после тишины + локальные максимумы
      const cand = [];
      for (let i = 1; i < env.length - 1; i++) {
        const rising = env[i] > floor && (env[i - 1] <= floor || (env[i] > env[i - 1] && env[i] >= env[i + 1]));
        if (rising) cand.push({ i, a: env[i] });
      }
      cand.sort((a, b) => b.a - a.a);
      const marks = [0];
      cand.forEach((c) => {
        if (marks.length >= count) return;
        const pos = (c.i * win) / len;
        if (pos < 0.02 || pos > 0.98) return;
        if (marks.some((m) => Math.abs(m - pos) < 0.015)) return;
        marks.push(pos);
      });
      marks.sort((a, b) => a - b);
      const res = S.sliceByMarks(marks);
      if (res.length < count) {
        // не нашли достаточно пиков — добиваем равномерно
        return S.sliceByGrid(count);
      }
      return res;
    };

    S.sliceAt = function (x) {
      const n = S.slices.length || 1;
      const i = Math.min(n - 1, Math.max(0, Math.floor(clamp(x, 0, 1) * n)));
      return S.slices[i];
    };

    /* Играет сэмпл/слайс. x — позиция слайса по пэду, y — тембр, dur — секунды */
    /* dur — ограничение длительности (для лупа); null = до конца слайса */
    S.play = function (x, y, velocity, dur) {
      if (!S.buffer) return null;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = S.buffer;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = expMap(300, 16000, y != null ? y : 0.7);
      filt.Q.value = 0.9;
      const amp = ctx.createGain();
      const g = Math.max(0.02, Math.min(1, velocity != null ? velocity : 0.9));
      amp.gain.value = g;
      src.connect(filt); filt.connect(amp); amp.connect(root);

      let rate = 1;
      let offset = 0;
      let length = S.buffer.duration;

      if (S.sliceMode && S.slices.length) {
        const sl = S.sliceAt(x);
        offset = sl.start * S.buffer.duration;
        length = Math.max(0.02, (sl.end - sl.start) * S.buffer.duration);
      }
      if (S.xMode === 'pitch') rate = Math.pow(2, (clamp(x, 0, 1) * S.pitchRange) / 12);
      if (S.xMode === 'speed') rate = lerp(0.5, 2, x);

      src.playbackRate.value = rate;
      const hold = dur != null ? dur : length;
      try { src.start(now, offset, Math.max(0.02, hold * Math.abs(rate))); } catch (err) { src.start(now); }
      const stopAt = now + hold + 0.02;
      amp.gain.setValueAtTime(g, now);
      amp.gain.setValueAtTime(g, now + Math.max(0.01, hold * 0.8));
      amp.gain.linearRampToValueAtTime(0.0001, stopAt);
      try { src.stop(stopAt + 0.02); } catch (err) {}
      const voice = { src, amp, filt, start: now, stop: () => { try { src.stop(); } catch (e) {} } };
      S.active.push(voice);
      src.onended = () => {
        S.active = S.active.filter((v) => v !== voice);
        try { amp.disconnect(); } catch (e) {}
      };
      return voice;
    };

    /* Длительность слайса под X (для лупа) */
    S.durationAt = function (x) {
      if (!S.buffer) return 0.5;
      if (S.sliceMode && S.slices.length) {
        const sl = S.sliceAt(x);
        return Math.max(0.05, (sl.end - sl.start) * S.buffer.duration);
      }
      return S.buffer.duration;
    };

    S.stopAll = function () {
      S.active.forEach((v) => { try { v.stop(); } catch (e) {} });
      S.active = [];
    };

    return S;
  };

  /* --- Конвертация фразы лупа в ноты проекта --- */
  /* segs: [{t0,t1,midi,x,y,v}] в секундах; bpm, stepsPerBar → список {at,m,len,v} */
  K.loopToNotes = function (segs, opts) {
    opts = opts || {};
    const bpm = opts.bpm || 120;
    const stepsPerBar = opts.stepsPerBar || 16;
    const bars = opts.bars || 1;
    const stepDur = 60 / bpm / 4;
    const totalSteps = stepsPerBar * bars;
    const out = [];
    (segs || []).forEach((sg) => {
      const at = Math.round(sg.t0 / stepDur) % totalSteps;
      const len = Math.max(1, Math.round((sg.t1 - sg.t0) / stepDur));
      const m = sg.midi != null ? sg.midi : 60;
      // если на этом шаге уже есть нота — не дублируем
      if (out.some((n) => n.at === at && n.m === m)) return;
      out.push({ at, m, len: Math.min(len, totalSteps - at), v: sg.v != null ? sg.v : 0.85 });
    });
    return out;
  };

  K.PROGRAMS = PROGRAMS;
  K.CAT_NAMES = CAT_NAMES;
  K.SCALES = SCALES;
  K.WAVES = WAVES;
  window.Kaoss = K;
})();
