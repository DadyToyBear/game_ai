/* Mini Studio — звуковой движок.
   Всё строится на Web Audio API: виртуальные машины (синтезаторы),
   драм-машина, микшер, эффекты, мастер-секция и офлайн-рендер в WAV. */
(function () {
  'use strict';

  const A = {};

  // ---------- утилиты ----------
  A.midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const noiseCache = new WeakMap();
  function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (buf) return buf;
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
    return buf;
  }

  const curveCache = new WeakMap();
  function bitCurve(ctx, bits) {
    let m = curveCache.get(ctx);
    if (!m) { m = new Map(); curveCache.set(ctx, m); }
    const key = 'bits' + bits;
    if (m.has(key)) return m.get(key);
    const steps = Math.pow(2, Math.max(1, bits - 1));
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    m.set(key, curve);
    return curve;
  }

  function pulseWave(ctx, duty) {
    duty = Math.min(0.95, Math.max(0.05, duty));
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function hold(param, time) {
    try { param.cancelAndHoldAtTime(time); }
    catch (e) { param.cancelScheduledValues(time); }
  }

  function impulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function distortion(ctx, amount) {
    const ws = ctx.createWaveShaper();
    const k = amount * 40;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  // ---------- микшер ----------
  /* Вход каждого модуля: gain -> [dry, delay send, reverb send] -> master */
  A.createMixer = function (ctx) {
    const masterIn = ctx.createGain();

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf'; eqLow.frequency.value = 180;
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking'; eqMid.frequency.value = 1200; eqMid.Q.value = 0.9;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf'; eqHigh.frequency.value = 6000;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 12;
    comp.attack.value = 0.003; comp.release.value = 0.12;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.85;

    masterIn.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
    eqHigh.connect(comp); comp.connect(masterGain); masterGain.connect(ctx.destination);

    // эффект-шины
    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.28;
    const feedback = ctx.createGain(); feedback.gain.value = 0.38;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200;
    delayIn.connect(delay); delay.connect(damp); damp.connect(feedback); feedback.connect(delay);
    const delayOut = ctx.createGain(); delayOut.gain.value = 0.9;
    damp.connect(delayOut); delayOut.connect(masterIn);

    const revIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.4, 2.6);
    const revOut = ctx.createGain(); revOut.gain.value = 0.7;
    revIn.connect(conv); conv.connect(revOut); revOut.connect(masterIn);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    masterGain.connect(analyser);

    return {
      ctx, input: masterIn, masterGain, analyser,
      eqLow, eqMid, eqHigh, comp,
      delayIn, revIn,
      setDelayTime(sec) { delay.delayTime.setTargetAtTime(sec, ctx.currentTime, 0.05); },
      setFeedback(v) { feedback.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    };
  };

  /* Канал модуля: gain -> pan -> [dry / sends] */
  A.createChannel = function (ctx, mixer) {
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const delaySend = ctx.createGain();
    const revSend = ctx.createGain();
    delaySend.gain.value = 0;
    revSend.gain.value = 0;

    /* fxOut — точка врезки Kaoss-процессора (null = прямой путь) */
    let tail = gain;
    if (pan) { gain.connect(pan); tail = pan; }
    const ch = { gain, pan, delaySend, revSend, input: gain, tail: tail, fxOut: null };
    A.wireChannel(ch, mixer);
    return ch;
  };

  /* Подключение хвоста канала к мастеру и посылам.
     Если ch.fxOut задан — сначала проходит через него. */
  A.wireChannel = function (ch, mixer) {
    try { ch.tail.disconnect(); } catch (e) {}
    const dest = ch.fxOut || mixer.input;
    ch.tail.connect(dest);
    ch.tail.connect(ch.delaySend); ch.delaySend.connect(mixer.delayIn);
    ch.tail.connect(ch.revSend); ch.revSend.connect(mixer.revIn);
  };

  /* Полное отключение канала: при смене состава машин старые каналы
     оставались подключёнными к мастеру (и к шинам эффектов) — каждый
     «добавить машину»/«удалить» подмешивал лишние узлы в мастер. */
  A.disposeChannel = function (ch) {
    if (!ch) return;
    [ch.gain, ch.pan, ch.delaySend, ch.revSend].forEach((n) => {
      if (n && n.disconnect) { try { n.disconnect(); } catch (e) { /* уже отключён */ } }
    });
  };

  /* Врезка/снятие внешнего процессора */
  A.setChannelFX = function (ch, mixer, fxNode) {
    ch.fxOut = fxNode || null;
    A.wireChannel(ch, mixer);
  };

  // ---------- конверты ----------
  function attackEnv(amp, p, t, velocity) {
    const g = amp.gain;
    const a = Math.max(0.001, p.a);
    const d = Math.max(0.005, p.d);
    const peak = 0.0001 + velocity;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.linearRampToValueAtTime(Math.max(0.0002, peak * p.s), t + a + d);
  }

  // ---------- голоса ----------
  class Voice {
    constructor(ctx, dest, engine, params, midi, velocity, time, sample) {
      this.ctx = ctx;
      this.engine = engine;
      this.params = Object.assign({}, params);
      this.dest = dest;
      this.midi = midi;
      this.freq = A.midiToFreq(midi);
      this.time = time;
      this.velocity = velocity;
      this.sample = sample || null;
      this.oscs = [];
      this.stopped = false;
      this.out = ctx.createGain();
      this.out.gain.value = params.level != null ? params.level : 0.5;
      this.out.connect(dest);
      this.build(time);
    }

    build(t) {
      const ctx = this.ctx;
      const p = this.params;
      const engine = this.engine;

      if (engine === 'subsynth') {
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.max(60, p.cutoff), t);
        filt.Q.value = p.res;
        if (p.env > 0) {
          filt.frequency.linearRampToValueAtTime(Math.min(18000, p.cutoff + p.env), t + 0.004);
          filt.frequency.exponentialRampToValueAtTime(Math.max(60, p.cutoff), t + Math.max(0.05, p.d));
        }
        const amp = ctx.createGain();
        filt.connect(amp); amp.connect(this.out);
        attackEnv(amp, p, t, this.velocity);

        const det = Math.pow(2, (p.detune || 0) / 1200);
        [1 / det, det].forEach((mult) => {
          const o = ctx.createOscillator();
          o.type = p.wave;
          o.frequency.value = this.freq * mult;
          o.connect(filt);
          o.start(t);
          this.oscs.push(o);
        });
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = this.freq / 2;
        const subG = ctx.createGain();
        subG.gain.value = p.sub;
        sub.connect(subG); subG.connect(filt);
        sub.start(t);
        this.oscs.push(sub);
        this.filter = filt;
        this.amp = amp;
      }

      else if (engine === 'bassline') {
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.max(80, p.cutoff), t);
        filt.Q.value = p.res;
        filt.frequency.linearRampToValueAtTime(Math.min(18000, p.cutoff + p.env * this.velocity), t + 0.006);
        filt.frequency.exponentialRampToValueAtTime(Math.max(80, p.cutoff), t + Math.max(0.03, p.decay));

        const drive = distortion(ctx, p.drive);
        const amp = ctx.createGain();
        filt.connect(drive); drive.connect(amp); amp.connect(this.out);
        attackEnv(amp, { a: 0.003, d: p.decay, s: 0.55 }, t, this.velocity);

        const o = ctx.createOscillator();
        o.type = p.wave;
        o.frequency.value = this.freq;
        o.connect(filt);
        o.start(t);
        this.oscs.push(o);
        this.filter = filt;
        this.amp = amp;
        this.monoOsc = o;
      }

      else if (engine === 'pcmsynth') {
        const filterNode = ctx.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.value = Math.min(18000, p.cutoff);
        filterNode.Q.value = 0.7;
        const amp = ctx.createGain();
        filterNode.connect(amp); amp.connect(this.out);
        attackEnv(amp, p, t, this.velocity);
        this.filter = filterNode;
        this.amp = amp;

        const buf = this.sample ? A.sampleBuffer(ctx, this.sample) : null;
        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const semis = (this.midi - p.root) + (p.tune || 0);
          src.playbackRate.value = Math.pow(2, semis / 12);
          src.connect(filterNode);
          const offset = Math.min(buf.duration - 0.01, Math.max(0, p.start * buf.duration));
          src.start(t, Math.max(0, offset));
          this.oscs.push(src);
          this.src = src;
        } else {
          // нет сэмпла — мягкий синус-подклад, чтобы машина не молчала
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = this.freq;
          const g = ctx.createGain();
          g.gain.value = 0.25;
          o.connect(g); g.connect(filterNode);
          o.start(t);
          this.oscs.push(o);
          this.osc = o;
        }
      }

      else if (engine === 'fmsynth') {
        const amp = ctx.createGain();
        amp.connect(this.out);
        attackEnv(amp, p, t, this.velocity);

        const carrier = ctx.createOscillator();
        carrier.type = p.wave || 'sine';
        carrier.frequency.value = this.freq;
        const modAmp = ctx.createGain();
        const modEnv = ctx.createGain();
        modAmp.gain.value = p.index * this.freq;
        modAmp.gain.setValueAtTime(p.index * this.freq, t);
        modAmp.gain.exponentialRampToValueAtTime(Math.max(1, p.index * this.freq * 0.05), t + Math.max(0.05, p.decay));
        modAmp.connect(carrier.frequency);

        const mod = ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.value = this.freq * p.ratio;
        mod.connect(modAmp);

        const mod2Amp = ctx.createGain();
        mod2Amp.gain.value = p.index2 * this.freq * p.ratio;
        mod2Amp.connect(mod.frequency);
        const mod2 = ctx.createOscillator();
        mod2.type = 'sine';
        mod2.frequency.value = this.freq * p.ratio2;
        mod2.connect(mod2Amp);

        modEnv.gain.value = 1;
        carrier.connect(amp);
        [carrier, mod, mod2].forEach((o) => { o.start(t); this.oscs.push(o); });
        this.amp = amp;
        this.carrier = carrier;
        this.modAmp = modAmp;
        this.mod2Amp = mod2Amp;
      }

      else if (engine === 'padsynth') {
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = p.cutoff;
        filt.Q.value = p.res;
        const amp = ctx.createGain();
        filt.connect(amp); amp.connect(this.out);
        attackEnv(amp, p, t, this.velocity);

        const n = Math.max(1, Math.round(p.voices));
        for (let i = 0; i < n; i++) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          const spread = n === 1 ? 0 : ((i / (n - 1)) * 2 - 1) * p.spread;
          o.frequency.value = this.freq * Math.pow(2, spread / 1200);
          o.detune.value = spread * 0.5;
          const g = ctx.createGain();
          g.gain.value = 1 / n;
          o.connect(g); g.connect(filt);
          o.start(t);
          this.oscs.push(o);
        }
        this.filter = filt;
        this.amp = amp;
      }

      else if (engine === 'eightbit') {
        const amp = ctx.createGain();
        const shaper = ctx.createWaveShaper();
        shaper.curve = bitCurve(ctx, Math.round(p.bits));
        shaper.connect(amp); amp.connect(this.out);
        attackEnv(amp, p, t, this.velocity);

        const o = ctx.createOscillator();
        o.setPeriodicWave(pulseWave(ctx, p.duty));
        o.frequency.setValueAtTime(this.freq, t);
        if (p.pitchEnv) {
          const target = this.freq * Math.pow(2, p.pitchEnv / 12);
          o.frequency.setValueAtTime(target, t);
          o.frequency.exponentialRampToValueAtTime(this.freq, t + 0.08);
        }
        o.connect(shaper);
        o.start(t);
        this.oscs.push(o);
        this.osc = o;
        this.amp = amp;

        if (p.vibrato > 0) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5.5;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = this.freq * 0.012 * p.vibrato;
          lfo.connect(lfoGain); lfoGain.connect(o.frequency);
          lfo.start(t);
          this.oscs.push(lfo);
        }
      }
    }

    setParam(k, v) {
      const p = this.params;
      const t = this.ctx.currentTime;
      p[k] = v;
      if (this.engine === 'subsynth') {
        if (k === 'cutoff' && this.filter) this.filter.frequency.setTargetAtTime(v, t, 0.02);
        if (k === 'res' && this.filter) this.filter.Q.setTargetAtTime(v, t, 0.02);
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
      } else if (this.engine === 'bassline') {
        if (k === 'cutoff' && this.filter) this.filter.frequency.setTargetAtTime(v, t, 0.02);
        if (k === 'res' && this.filter) this.filter.Q.setTargetAtTime(v, t, 0.02);
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
        if (k === 'wave' && this.monoOsc) this.monoOsc.type = v;
      } else if (this.engine === 'padsynth') {
        if (k === 'cutoff' && this.filter) this.filter.frequency.setTargetAtTime(v, t, 0.02);
        if (k === 'res' && this.filter) this.filter.Q.setTargetAtTime(v, t, 0.02);
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
      } else if (this.engine === 'eightbit') {
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
        if (k === 'duty' && this.osc) this.osc.setPeriodicWave(pulseWave(this.ctx, v));
      } else if (this.engine === 'pcmsynth') {
        if (k === 'cutoff' && this.filter) this.filter.frequency.setTargetAtTime(v, t, 0.02);
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
      } else if (this.engine === 'fmsynth') {
        if (k === 'index' && this.modAmp) this.modAmp.gain.setTargetAtTime(v * this.freq, t, 0.02);
        if (k === 'level' && this.out) this.out.gain.setTargetAtTime(v, t, 0.02);
      }
    }

    release(t) {
      if (this.stopped) return;
      this.stopped = true;
      const p = this.params;
      const r = Math.max(0.01, p.r != null ? p.r : 0.2);
      if (this.amp) {
        hold(this.amp.gain, t);
        this.amp.gain.linearRampToValueAtTime(0.0001, t + r);
      }
      const stopAt = t + r + 0.05;
      this.oscs.forEach((o) => {
        try { o.stop(stopAt); } catch (e) { /* уже остановлен */ }
      });
      // освобождение узлов
      setTimeout(() => { try { this.out.disconnect(); } catch (e) {} }, (r + 0.2) * 1000);
    }

    kill(t) {
      this.stopped = true;
      this.oscs.forEach((o) => { try { o.stop(t || this.ctx.currentTime); } catch (e) {} });
      try { this.out.disconnect(); } catch (e) {}
    }
  }

  A.Voice = Voice;

  /* Планирует голос с фиксированной длительностью (для секвенсора/рендера) */
  A.playNote = function (ctx, dest, engine, params, midi, velocity, time, duration, sample) {
    const v = new Voice(ctx, dest, engine, params, midi, velocity, time, sample);
    v.release(time + Math.max(0.02, duration));
    return v;
  };

  // ---------- сэмплы ----------
  /* Кэш: контекст -> Map(объект сэмпла -> AudioBuffer) */
  const sampleCache = new WeakMap();
  A.sampleBuffer = function (ctx, sample) {
    if (!sample || !sample.channels || !sample.channels.length) return null;
    let map = sampleCache.get(ctx);
    if (!map) { map = new Map(); sampleCache.set(ctx, map); }
    if (map.has(sample)) return map.get(sample);
    const buf = ctx.createBuffer(sample.channels.length, sample.channels[0].length, sample.sampleRate || ctx.sampleRate);
    sample.channels.forEach((data, i) => buf.copyToChannel(data, i));
    map.set(sample, buf);
    return buf;
  };

  // ---------- драм-машина ----------
  A.playDrum = function (ctx, dest, params, pad, time, velocity, sample) {
    const p = params || {};
    const pitch = Math.pow(2, (p.tune || 0) / 12);
    const dec = p.decay || 1;
    const snap = p.snap != null ? p.snap : 0.5;
    const lvl = (p.level != null ? p.level : 0.9) * velocity;

    const audioBuffer = sample ? A.sampleBuffer(ctx, sample) : null;
    if (audioBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = lvl;
      src.connect(g); g.connect(dest);
      src.start(time);
      return;
    }

    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      return n;
    };

    const env = (node, peak, attack, decay) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
      node.connect(g); g.connect(dest);
      return g;
    };

    const stopAt = (src, dur) => {
      try { src.start(time); src.stop(time + dur + 0.05); } catch (e) {}
    };

    switch (pad) {
      case 0: { // kick
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(160 * pitch, time);
        o.frequency.exponentialRampToValueAtTime(42 * pitch, time + 0.11 * dec);
        env(o, lvl, 0.002, 0.36 * dec);
        stopAt(o, 0.5 * dec);
        if (snap > 0.05) {
          const n = noise();
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass'; hp.frequency.value = 1800;
          n.connect(hp);
          env(hp, lvl * snap * 0.35, 0.001, 0.02);
          stopAt(n, 0.06);
        }
        break;
      }
      case 1: { // snare
        const n = noise();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1500;
        n.connect(hp);
        env(hp, lvl * 0.7, 0.001, 0.18 * dec);
        stopAt(n, 0.3 * dec);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(190 * pitch, time);
        o.frequency.exponentialRampToValueAtTime(120 * pitch, time + 0.09);
        env(o, lvl * 0.5, 0.001, 0.1 * dec);
        stopAt(o, 0.2);
        break;
      }
      case 2: { // hat closed
        const n = noise();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 7500;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.8;
        n.connect(hp); hp.connect(bp);
        env(bp, lvl * 0.35, 0.001, 0.045 * dec);
        stopAt(n, 0.09);
        break;
      }
      case 3: { // hat open
        const n = noise();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 6500;
        n.connect(hp);
        env(hp, lvl * 0.28, 0.002, 0.28 * dec);
        stopAt(n, 0.4 * dec);
        break;
      }
      case 4: { // clap
        for (let i = 0; i < 3; i++) {
          const t = time + i * 0.011;
          const n = ctx.createBufferSource();
          n.buffer = noiseBuffer(ctx);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.6;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(lvl * 0.4, t + 0.001);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
          n.connect(bp); bp.connect(g); g.connect(dest);
          n.start(t); n.stop(t + 0.05);
        }
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time + 0.033);
        g.gain.linearRampToValueAtTime(lvl * 0.35, time + 0.036);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16 * dec);
        n.connect(bp); bp.connect(g); g.connect(dest);
        n.start(time + 0.03); n.stop(time + 0.3 * dec);
        break;
      }
      case 5: case 6: { // toms
        const base = pad === 5 ? 120 : 190;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(base * pitch, time);
        o.frequency.exponentialRampToValueAtTime(base * 0.55 * pitch, time + 0.18 * dec);
        env(o, lvl * 0.75, 0.002, 0.28 * dec);
        stopAt(o, 0.4 * dec);
        break;
      }
      case 7: { // rim
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 1700 * pitch;
        env(o, lvl * 0.22, 0.001, 0.035);
        stopAt(o, 0.07);
        const n = noise();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
        n.connect(bp);
        env(bp, lvl * 0.3, 0.001, 0.03);
        stopAt(n, 0.06);
        break;
      }
      default:
        break;
    }
  };

  // ---------- рендер ----------
  /* Рендерит массив событий в WAV-буфер.
     events: [{engine, params, midi, pad, velocity, time, duration, channel}]
     channels: [{index, gain, pan, delay, reverb}]                                */
  A.renderToBuffer = function (song, totalSeconds, sampleRate) {
    sampleRate = sampleRate || 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil((totalSeconds + 2) * sampleRate), sampleRate);
    const mixer = A.createMixer(ctx);
    const chans = {};
    song.tracks.forEach((tr, i) => {
      const ch = A.createChannel(ctx, mixer);
      ch.gain.gain.value = tr.vol != null ? tr.vol : 0.8;
      if (ch.pan) ch.pan.pan.value = tr.pan || 0;
      ch.delaySend.gain.value = tr.delay || 0;
      ch.revSend.gain.value = tr.reverb || 0;
      chans[i] = ch;
    });
    mixer.setFeedback(song.feedback != null ? song.feedback : 0.35);
    mixer.setDelayTime((60 / song.bpm) * 0.75);
    mixer.masterGain.gain.value = song.masterVol != null ? song.masterVol : 0.85;
    if (song.eq) {
      mixer.eqLow.gain.value = song.eq.low || 0;
      mixer.eqMid.gain.value = song.eq.mid || 0;
      mixer.eqHigh.gain.value = song.eq.high || 0;
    }

    song.events.forEach((ev) => {
      const ch = chans[ev.channel];
      if (!ch) return;
      if (ev.engine === 'beatbox') {
        A.playDrum(ctx, ch.input, ev.params, ev.pad, ev.time, ev.velocity, ev.sample);
      } else {
        A.playNote(ctx, ch.input, ev.engine, ev.params, ev.midi, ev.velocity, ev.time, ev.duration, ev.sample);
      }
    });
    return ctx.startRendering();
  };

  A.encodeWav = function (buffer) {
    const numCh = buffer.numberOfChannels;
    const len = buffer.length;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const view = new DataView(ab);
    const writeStr = (offset, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF'); view.setUint32(4, bytes - 8, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * numCh * 2, true);
    view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
    writeStr(36, 'data'); view.setUint32(40, len * numCh * 2, true);

    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  };

  window.AudioEngine = A;
})();
