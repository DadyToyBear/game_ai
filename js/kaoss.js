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
      lastMidi: null,
      midi: 60,
      y: 0.5,
    };

    function paramsFor(inst2, y) {
      const bright = clamp(y, 0, 1);
      return {
        wave: inst2.wave,
        detune: 6,
        sub: 0.25 + (1 - bright) * 0.35,
        cutoff: expMap(220, 11000, bright),
        res: 2 + (1 - bright) * 8,
        env: expMap(0, 4200, bright),
        a: 0.004,
        d: 0.18 + (1 - bright) * 0.2,
        s: 0.55,
        r: 0.18,
        level: 0.5,
      };
    }

    /* X (0..1) → нота по гамме, Y (0..1) → яркость/срез */
    inst.quantize = function (x) {
      const sc = SCALES[inst.scale] || SCALES.chromatic;
      const total = sc.length;
      const idx = Math.round(x * (total * 2 - 1));
      const oct = Math.floor(idx / total);
      const deg = ((idx % total) + total) % total;
      return 12 * (inst.octave + oct) + sc[deg];
    };

    inst.noteOn = function (x, y, velocity) {
      inst.x = x;
      inst.y = y;
      const midi = inst.quantize(x);
      inst.midi = midi;
      if (inst.voice && inst.lastMidi === midi) {
        inst.voice.setParam('cutoff', expMap(220, 11000, y));
        return midi;
      }
      if (inst.voice) inst.voice.kill(ctx.currentTime);
      const p = paramsFor(inst, y);
      inst.voice = newVoice(ctx, out, 'subsynth', p, midi, velocity != null ? velocity : 0.9, ctx.currentTime);
      inst.lastMidi = midi;
      // запись сегментов фразы
      if (inst.recSlot >= 0) {
        const now = ctx.currentTime - inst.recStart;
        if (inst.recSegs.length) {
          const last = inst.recSegs[inst.recSegs.length - 1];
          if (last.t1 == null) last.t1 = now;
        }
        inst.recSegs.push({ t0: now, t1: null, midi, y, v: velocity != null ? velocity : 0.9 });
      }
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

    inst.noteOff = function () {
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
          window.AudioEngine.playNote(ctx, out, 'subsynth', paramsFor(inst, s.y), s.midi, s.v, start, dur);
        });
        inst.loopTimers[slot] = setTimeout(tick, len * 1000);
      };
      tick();
    };

    inst.stopLoop = function (slot) {
      inst.playingLoops[slot] = false;
      if (inst.loopTimers[slot]) { clearTimeout(inst.loopTimers[slot]); inst.loopTimers[slot] = null; }
    };

    inst.stopAll = function () {
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

    const fx = {
      input, output, programs: PROGRAMS, program: 0,
      hold: false,
      x: 0.5, y: 0.5,
      active: false,
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
    return fx;
  };

  K.SCALES = SCALES;
  K.WAVES = WAVES;
  window.Kaoss = K;
})();
