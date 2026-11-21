/* Mini Studio — приложение: состояние проекта, стойка, секвенсор, пиано-ролл,
   микшер, MIDI-вход и экспорт. */
(function () {
  'use strict';

  const AE = window.AudioEngine;
  const ENG = window.ENGINES;
  const el = UI.el;

  const LS_KEY = 'mini-studio-project-v1';
  const PIO = window.ProjectIO;

  const PAD_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];
  const KEYMAP = {
    z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
    q: 60, '2': 61, w: 62, '3': 63, e: 64, r: 65, '5': 66, t: 67, '6': 68, y: 69, '7': 70, u: 71,
  };

  const state = {
    ctx: null,
    mixer: null,
    channels: [],
    seq: null,
    playing: false,
    recording: false,
    currentStep: 0,
    nextTime: 0,
    timer: null,
    stepDur: 0.125,
    activeTrack: 0,
    liveVoices: {},
    lastNote: {},
    midiAccess: null,
    midiInputs: [],
    midiOutId: '',
    midiOutChannel: 0,
    kaossInst: null,
    kaossFX: null,
    fxChannels: [],
    cellRefs: [],
    lastPlayed: -1,
  };

  let song = null;

  // ---------- модель проекта ----------
  function uid() { return Math.random().toString(36).slice(2, 9); }

  function newTrack(engine, name, params) {
    const t = {
      id: uid(),
      engine,
      name: name || ENG[engine].name,
      vol: 0.8,
      pan: 0,
      delay: 0,
      reverb: engine === 'padsynth' ? 0.35 : 0.08,
      mute: false,
      params: window.defaultParams(engine, params),
      bank: [],       // 4 паттерна A/B/C/D: { notes: [{at,m,len,v}], pads: [{at,p}] }
      patIndex: 0,    // активный паттерн
      used: [0],      // паттерны, участвующие в аранжировке
      scenes: 'A',    // строка редактора сцен: буква паттерна для каждого такта
      patLen: 64,     // шагов в паттерне (обновляется resizePatterns)
      samples: {},    // padIndex (beatbox) или 'main' (pcmsynth) -> {channels, sampleRate}
      follow: true,   // пиано-ролл сам подкручивается под играющий такт
      rollZoom: 1,    // масштаб дорожек пиано-ролла этой машины (0.7 … 1.8)
      rollCollapsed: false, // свёрнут ли свой секвенсор в стойке
    };
    return t;
  }

  /* Высота дорожки сетки: мелодическим машинам нужны строки повыше —
     на телефоне иначе в них не попасть пальцем. */
  function rowHeightFor(engine) {
    return engine === 'beatbox' ? 26 : 30;
  }

  function emptySong() {
    const tracks = [
      newTrack('beatbox', 'Бит'),
      newTrack('bassline', 'Бас'),
      newTrack('subsynth', 'Синт'),
    ];
    const s = {
      bpm: 120,
      steps: 16,
      bars: 1,
      arrangeBars: 4,
      feedback: 0.35,
      tracks,
      masterVol: 0.85,
      eq: { low: 0, mid: 0, high: 0 },
    };
    s.patternLen = s.steps * s.bars;
    resizePatterns(s);
    return s;
  }

  function totalSteps() { return song.patternLen || song.steps * song.bars; }

  function resizePatterns(s) {
    if (s.arrangeBars == null) s.arrangeBars = 4;
    s.patternLen = s.steps * s.bars;
    const n = s.patternLen;
    s.tracks.forEach((t) => {
      Pattern.ensureTrack(t);
      t.patLen = n;
      t.bank.forEach((b) => {
        b.notes = b.notes.filter((x) => x.at < n).map((x) => {
          x.len = Math.min(x.len || 1, n - x.at);
          return x;
        });
        b.pads = b.pads.filter((x) => x.at < n);
      });
      t.scenes = (t.scenes || 'A').slice(0, s.arrangeBars).padEnd(s.arrangeBars, 'A');
    });
  }

  /* Сколько тактов в паттерне и сколько в аранжировке */
  function patternBars() { return song.bars; }
  function patternSteps() { return song.steps * song.bars; }
  function clipSteps() { return song.steps; }
  function arrangeSteps() { return song.steps * song.arrangeBars; }

  // ---------- аудио ----------
  function ensureAudio() {
    if (state.ctx) {
      if (state.ctx.state === 'suspended') state.ctx.resume();
      return state.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.ctx = new Ctx({ latencyHint: 'interactive' });
    state.mixer = AE.createMixer(state.ctx);
    state.channels = song.tracks.map((t) => {
      const ch = AE.createChannel(state.ctx, state.mixer);
      applyChannel(t, ch);
      return ch;
    });
    state.kaossInst = Kaoss.createInstrument(state.ctx, state.mixer.input);
    state.kaossInst.bpm = song.bpm;
    state.kaossInst.name = 'Kaossilator';
    state.kaossFX = Kaoss.createFX(state.ctx);
    applyFxRouting();
    bindKaossMidi();
    if (pendingKaoss) { applyKaossState(pendingKaoss); pendingKaoss = null; }
    return state.ctx;
  }

  function applyChannel(t, ch) {
    ch.gain.gain.value = t.mute ? 0 : t.vol;
    if (ch.pan) ch.pan.pan.value = t.pan;
    ch.delaySend.gain.value = t.delay;
    ch.revSend.gain.value = t.reverb;
  }

  function updateStepDur() {
    state.stepDur = 60 / song.bpm / 4;
  }

  function currentStepDuration() {
    updateStepDur();
    return state.stepDur;
  }

  // ---------- воспроизведение ----------
  function startTransport() {
    ensureAudio();
    if (state.playing) return stopTransport();
    state.playing = true;
    state.currentStep = 0;
    state.nextTime = state.ctx.currentTime + 0.06;
    state.timer = setInterval(scheduler, 25);
    sendClockStart();
    startMidiClock();
    const bp = document.getElementById('btnPlay');
    bp.classList.add('on');
    bp.querySelector('.lbl').textContent = 'Стоп';
    bp.querySelector('.ico').textContent = '❚❚';
    updateStepDur();
  }

  function stopTransport() {
    state.playing = false;
    clearInterval(state.timer);
    state.timer = null;
    const bp = document.getElementById('btnPlay');
    bp.classList.remove('on');
    bp.querySelector('.lbl').textContent = 'Играть';
    bp.querySelector('.ico').textContent = '▶';
    sendClockStop();
    stopMidiClock();
    panicVoices();
    clearPlayhead();
    document.getElementById('pos').textContent = '001 : 01';
  }

  function scheduler() {
    if (!state.playing || !state.ctx) return;
    const ahead = 0.12;
    while (state.nextTime < state.ctx.currentTime + ahead) {
      playArrangeStep(state.currentStep, state.nextTime);
      state.nextTime += currentStepDuration() * (state.swing ? 1 : 1);
      state.currentStep = (state.currentStep + 1) % arrangeSteps();
    }
    paintPlayhead();
  }

  /* Один шаг аранжировки: для каждой дорожки берём паттерн из её строки сцен.
     Каждый такт аранжировки играет соответствующий такт паттерна, по кругу. */
  function playArrangeStep(absStep, time) {
    const spb = song.steps;
    const bar = Math.floor(absStep / spb);
    const localStep = absStep % spb;
    const patBar = bar % Math.max(1, song.bars);
    const patStep = patBar * spb + localStep;

    song.tracks.forEach((t, i) => {
      if (t.mute) return;
      const ch = state.channels[i];
      if (!ch) return;
      const letter = (t.scenes || 'A').charAt(bar) || 'A';
      const idx = 'ABCD'.indexOf(letter);
      const pat = Pattern.pattern(t, idx < 0 ? 0 : idx);

      const outOn = !!midiOut();
      const when = state.ctx ? Math.max(0, (time - state.ctx.currentTime) * 1000) : 0;
      if (t.engine === 'beatbox') {
        (pat.pads || []).forEach((e) => {
          if (e.at !== patStep) return;
          AE.playDrum(state.ctx, ch.input, t.params, e.p, time, 0.95, t.samples[e.p] || null);
          if (outOn) scheduleMidiOut(when, () => sendTrackNote(t, 0, 0.95, 80, e.p));
        });
      } else {
        const smp = ENG[t.engine].sampler ? (t.samples.main || null) : null;
        (pat.notes || []).forEach((n) => {
          if (n.at !== patStep) return;
          const dur = currentStepDuration() * Math.max(1, Pattern.notelen(n)) * 0.95;
          AE.playNote(state.ctx, ch.input, t.engine, t.params, n.m, n.v != null ? n.v : 0.85, time, dur, smp);
          if (outOn) scheduleMidiOut(when, () => sendTrackNote(t, n.m, n.v != null ? n.v : 0.85, dur * 1000));
        });
      }
    });
    state.currentBar = bar;
  }

  /* Запись живых нот в активный паттерн (с учётом такта аранжировки) */
  function recordNote(t, midi, vel) {
    if (!t) return;
    const pat = Pattern.pattern(t);
    const step = recStep();
    pat.notes.push({ at: step, m: midi, len: 1, v: vel != null ? vel : 0.85 });
    Pattern.markUsed(t);
    renderSeq();
  }

  function recordPad(t, pad) {
    if (!t) return;
    const pat = Pattern.pattern(t);
    const step = recStep();
    if (!(pat.pads || []).some((e) => e.at === step && e.p === pad)) {
      pat.pads.push({ at: step, p: pad });
    }
    Pattern.markUsed(t);
    renderSeq();
  }

  /* Позиция шага внутри паттерна в момент записи */
  function recStep() {
    const spb = song.steps;
    const bar = Math.floor(state.currentStep / spb);
    const patBar = bar % Math.max(1, song.bars);
    return patBar * spb + (state.currentStep % spb);
  }

  /* Отправка MIDI-события в момент, близкий к аудио-таймлайну.
     Небольшие задержки (< 60 мс) шлём сразу: точность ±30 мс для внешнего
     синтезатора незаметна, а setTimeout при throttling вкладки врёт сильнее. */
  function scheduleMidiOut(delayMs, fn) {
    if (delayMs <= 60) { fn(); return; }
    setTimeout(fn, Math.min(400, delayMs));
  }

  /* Часы MIDI (F8) — 24 ppq, чтобы DAW/плагин не «спотыкался» о темп */
  function startMidiClock() {
    stopMidiClock();
    if (!midiOut()) return;
    const tickMs = 60000 / song.bpm / 24;
    state.clockTimer = setInterval(() => {
      if (!state.playing) return;
      sendMidi([0xf8]);
    }, tickMs);
  }

  function stopMidiClock() {
    if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = null; }
  }

  function panicVoices() {
    Object.keys(state.liveVoices).forEach((k) => {
      (state.liveVoices[k] || []).forEach((v) => v.kill());
    });
    state.liveVoices = {};
    document.querySelectorAll('.key.on').forEach((k) => k.classList.remove('on'));
    document.querySelectorAll('.pad.on').forEach((p) => p.classList.remove('on'));
  }

  function liveNoteOn(midi, vel, fromMidiInput) {
    const t = song.tracks[state.activeTrack];
    if (!t || t.mute) return;
    ensureAudio();
    const ch = state.channels[state.activeTrack];
    const list = state.liveVoices[state.activeTrack] || (state.liveVoices[state.activeTrack] = []);
    if (!ENG[t.engine].poly) list.forEach((v) => v.kill());
    const smp = ENG[t.engine].sampler ? (t.samples.main || null) : null;
    if (!fromMidiInput) sendTrackNote(t, midi, vel != null ? vel : 0.9, 400);
    const v = new AE.Voice(state.ctx, ch.input, t.engine, t.params, midi, vel != null ? vel : 0.9, state.ctx.currentTime, smp);
    list.push(v);
    if (list.length > 12) list.shift();
  }

  function liveNoteOff(midi) {
    const list = state.liveVoices[state.activeTrack] || [];
    list.forEach((v) => { if (v.midi === midi) v.release(state.ctx.currentTime); });
  }

  function liveDrum(pad) {
    const t = song.tracks[state.activeTrack];
    if (!t || t.engine !== 'beatbox') return;
    ensureAudio();
    const ch = state.channels[state.activeTrack];
    AE.playDrum(state.ctx, ch.input, t.params, pad, state.ctx.currentTime + 0.005, 1, t.samples[pad] || null);
    sendTrackNote(t, 0, 1, 80, pad);
  }

  function paintPlayhead() {
    if (state.currentStep === state.lastPlayed) return;
    state.lastPlayed = state.currentStep;
    document.querySelectorAll('.cell.playing, .head-cell.playhead').forEach((c) => {
      c.classList.remove('playing', 'playhead');
    });
    const spb = song.steps;
    const bar = Math.floor(state.currentStep / spb);
    const local = state.currentStep % spb;
    // планка в сетке паттерна (если редактор показывает этот такт)
    const patBar = bar % Math.max(1, song.bars);
    document.querySelectorAll('.cell[data-step="' + local + '"]').forEach((c) => c.classList.add('playing'));
    document.querySelectorAll('.head-cell[data-step="' + local + '"]').forEach((c) => c.classList.add('playhead'));
    // бегунок в пиано-роллах: у каждой машины свой ролл, ведём все сразу
    song.tracks.forEach((t, ti) => {
      if (t.engine === 'beatbox') return;
      Pattern.paintPlayhead(t, local);
    });
    document.getElementById('pos').textContent =
      String(bar + 1).padStart(3, '0') + ' : ' + String(Math.floor(local / 4) + 1).padStart(2, '0');
    paintSceneBar(bar, local);
    return patBar;
  }

  function paintSceneBar(bar, local) {
    document.querySelectorAll('.arr-cell').forEach((c) => {
      c.classList.toggle('now', Number(c.dataset.bar) === bar && local < 4);
    });
  }

  function clearPlayhead() {
    document.querySelectorAll('.cell.playing, .head-cell.playhead').forEach((c) => c.classList.remove('playing', 'playhead'));
    song.tracks.forEach((t) => Pattern.paintPlayhead(t, -1));
    state.lastPlayed = -1;
  }

  // ---------- отрисовка: стойка ----------
  function renderTracklist() {
    const box = document.getElementById('tracklist');
    box.innerHTML = '';
    song.tracks.forEach((t, i) => {
      const def = ENG[t.engine];
      const badge = el('div', { class: 'track-badge', style: { background: 'linear-gradient(150deg,' + def.accent + ',#5b7ea8)' } }, [def.short]);
      const item = el('div', {
        class: 'track-item' + (i === state.activeTrack ? ' active' : ''),
        onclick: () => { state.activeTrack = i; renderAll(); },
      }, [
        badge,
        el('div', { class: 'track-meta' }, [
          el('div', { class: 'track-name', text: t.name }),
          el('div', { class: 'track-sub', text: def.name }),
        ]),
        el('div', { class: 'track-mute' }, [
          el('button', {
            class: t.mute ? 'on' : '', text: 'M', title: 'Mute',
            onclick: (e) => { e.stopPropagation(); t.mute = !t.mute; refreshChannels(); renderAll(); },
          }),
        ]),
      ]);
      box.appendChild(item);
    });
    box.appendChild(el('button', { class: 'btn ghost', style: { marginTop: '4px' }, text: '+ Добавить машину', onclick: addMachineDialog }));
  }

  function applyTheme(accent) {
    document.documentElement.style.setProperty('--accent', accent);
  }

  function renderMachine() {
    const wrap = document.getElementById('machineWrap');
    wrap.innerHTML = '';
    const t = song.tracks[state.activeTrack];
    if (!t) return;
    const def = ENG[t.engine];
    applyTheme(def.accent);

    const presetSelect = el('select', { class: 'preset-select', onchange: (e) => {
      const p = def.presets[Number(e.target.value)];
      if (!p) return;
      resetParams();
      Object.assign(t.params, p.values);
      refreshLiveParams();
      renderMachine();
      UI.toast('Пресет: ' + p.name);
    } }, def.presets.map((p, i) => el('option', { value: i, text: p.name })));

    const head = el('div', { class: 'machine-head' }, [
      el('div', {
        class: 'track-badge',
        style: { background: 'linear-gradient(150deg,' + def.accent + ',#5b7ea8)', width: '44px', height: '44px', fontSize: '12px' },
      }, [def.short]),
      el('div', {}, [
        el('div', { class: 'machine-title', text: def.name }),
        el('div', { class: 'machine-desc', text: def.desc }),
      ]),
      el('div', { class: 'spacer' }),
      el('label', { class: 'hint', text: 'Пресет' }),
      presetSelect,
      def.sampler ? el('button', { class: 'btn ghost', text: 'Свои сэмплы', onclick: openSamplesDialog }) : null,
      el('button', { class: 'btn ghost', text: 'Удалить', onclick: removeTrack }),
    ]);

    const paramsBox = el('div', { class: 'knobs' });
    const mainGroup = el('div', { class: 'group' }, [el('div', { class: 'group-title', text: 'Параметры' })]);
    const modGroup = el('div', { class: 'group' }, [el('div', { class: 'group-title', text: 'Огибающая / модуляция' })]);
    def.params.forEach((p) => {
      if (p.type === 'select') {
        const sel = el('select', {
          class: 'preset-select',
          onchange: (e) => {
            t.params[p.k] = e.target.value;
            refreshLiveParams();
          },
        }, p.options.map((o) => el('option', { value: o.v, text: o.n })));
        sel.value = t.params[p.k];
        mainGroup.appendChild(el('div', { class: 'knob', style: { width: '78px' } }, [
          sel, el('span', { class: 'knob-label', text: p.label }),
        ]));
        return;
      }
      const k = UI.knob(p, t.params[p.k], (v) => {
        t.params[p.k] = v;
        refreshLiveParams();
      });
      (['a', 'd', 's', 'r'].indexOf(p.k) >= 0 ? modGroup : mainGroup).appendChild(k);
    });
    paramsBox.appendChild(mainGroup);
    if (modGroup.children.length > 1) paramsBox.appendChild(modGroup);

    const side = el('div', {}, t.engine === 'beatbox' ? [renderPads(t)] : [renderKeyboard(t)]);

    const body = el('div', { class: 'machine-body' }, [paramsBox, side]);
    const machine = el('div', { class: 'machine' }, [head, body]);

    if (t.engine !== 'beatbox') {
      Pattern.ensureTrack(t);
      const patHead = el('div', { class: 'machine-head', style: { borderTop: '1px solid var(--line)', paddingTop: '10px', paddingBottom: '10px' } }, [
        el('span', { class: 'hint', text: 'Паттерн' }),
        el('div', { class: 'pat-slots' }, [0, 1, 2, 3].map((i) =>
          el('button', {
            class: 'pat-slot' + (t.patIndex === i ? ' active' : '') + (t.used.indexOf(i) >= 0 ? ' used' : ''),
            text: 'ABCD'[i],
            onclick: () => { t.patIndex = i; Pattern.markUsed(t); renderMachine(); renderSeq(); },
          })
        )),
        el('button', {
          class: 'btn ghost', text: 'Копия', style: { fontSize: '11px', padding: '6px 9px' },
          onclick: () => { copyPatternDialog(); },
        }),
        el('button', {
          class: 'btn ghost', text: 'Клавиши ' + Pattern.zoomLabel(t), style: { fontSize: '11px', padding: '6px 9px' },
          title: 'Высота дорожек этого синтезатора',
          onclick: () => { Pattern.cycleZoom(t); renderMachine(); renderSeq(); },
        }),
        el('button', {
          class: 'btn ghost', text: t.rollCollapsed ? 'Развернуть' : 'Свернуть', style: { fontSize: '11px', padding: '6px 9px' },
          title: 'Убрать свой секвенсор, чтобы стойка была компактнее',
          onclick: () => { t.rollCollapsed = !t.rollCollapsed; renderMachine(); },
        }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: t.rollCollapsed ? 'свой секвенсор свёрнут' : 'свой секвенсор: тяните ноты, край — длина, точка — громкость' }),
      ]);
      machine.appendChild(patHead);
      if (!t.rollCollapsed) {
        const rollHost = el('div', { class: 'machine-roll' });
        machine.appendChild(rollHost);
        Pattern.mount(rollHost, t, {
          onChange: () => refreshSeqMiniState(),
          onPreview: (midi, v) => liveNoteOn(midi, v),
        });
      }
    }

    if (t.engine === 'beatbox') {
      // у драм-машины свой секвенсор: шаги по каждой подушке прямо в корпусе
      Pattern.ensureTrack(t);
      const drumHead = el('div', { class: 'machine-head', style: { borderTop: '1px solid var(--line)', paddingTop: '10px', paddingBottom: '8px' } }, [
        el('span', { class: 'hint', text: 'Свой секвенсор' }),
        el('div', { class: 'pat-slots' }, [0, 1, 2, 3].map((i) =>
          el('button', {
            class: 'pat-slot' + (t.patIndex === i ? ' active' : '') + (t.used.indexOf(i) >= 0 ? ' used' : ''),
            text: 'ABCD'[i],
            onclick: () => { t.patIndex = i; Pattern.markUsed(t); renderMachine(); renderSeq(); },
          })
        )),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: 'клик по шагу — удар · клавиши A S D F G H J K · свои WAV — в «Своих сэмплах»' }),
      ]);
      const drumBox = el('div', { class: 'drum-lanes' });
      machine.appendChild(drumHead);
      machine.appendChild(drumBox);
      setTimeout(() => drumLanes(drumBox, t), 0);
    }
    wrap.appendChild(machine);
  }

  /* Дорожки драм-машины: 8 подушек × шаги паттерна, всё в её корпусе. */
  function drumLanes(host, t) {
    host.innerHTML = '';
    const pat = Pattern.pattern(t);
    const steps = t.patLen;
    const row = el('div', { class: 'drum-row' }, [el('span', { class: 'drum-name', text: 'подушки' })]);
    for (let s = 0; s < steps; s++) {
      row.appendChild(el('span', {
        class: 'drum-tick' + (s % 4 === 0 ? ' beat' : ''),
        text: s % 4 === 0 ? String(s / 4 + 1) : '',
      }));
    }
    host.appendChild(row);

    ENG.beatbox.pads.forEach((name, pad) => {
      const line = el('div', { class: 'drum-row' }, [
        el('button', {
          class: 'drum-name',
          text: name,
          title: 'Прослушать подушку',
          onclick: () => { ensureAudio(); liveDrum(pad); },
        }),
      ]);
      for (let s = 0; s < steps; s++) {
        const on = (pat.pads || []).some((e) => e.at === s && e.p === pad);
        const cell = el('div', {
          class: 'drum-step' + (on ? ' on' : '') + (s % 4 === 0 ? ' beat' : ''),
          'data-pad': pad, 'data-step': s,
          onclick: () => {
            const arr = pat.pads || (pat.pads = []);
            const i = arr.findIndex((e) => e.at === s && e.p === pad);
            if (i >= 0) arr.splice(i, 1); else { arr.push({ at: s, p: pad }); ensureAudio(); liveDrum(pad); }
            Pattern.markUsed(t);
            cell.classList.toggle('on', i < 0);
            renderSeqGridOnly();
          },
        });
        line.appendChild(cell);
      }
      host.appendChild(line);
    });
  }

  function renderSeqGridOnly() {
    const grid = document.getElementById('seqGrid');
    if (!grid) return;
    grid.querySelectorAll('.cell[data-track]').forEach((c) => {
      const row = { ti: Number(c.dataset.track), pad: c.dataset.pad === '' ? null : Number(c.dataset.pad), beatbox: c.dataset.pad !== '' };
      const on = cellOn(row, Number(c.dataset.step));
      c.classList.toggle('on', on);
      c.classList.toggle('strong', on && Number(c.dataset.step) % 4 === 0);
    });
  }

  function resetParams() {
    const t = song.tracks[state.activeTrack];
    const def = ENG[t.engine];
    const fresh = window.defaultParams(t.engine);
    Object.keys(fresh).forEach((k) => { t.params[k] = fresh[k]; });
  }

  function refreshLiveParams() {
    const list = state.liveVoices[state.activeTrack] || [];
    const t = song.tracks[state.activeTrack];
    list.forEach((v) => {
      Object.keys(t.params).forEach((k) => v.setParam(k, t.params[k]));
    });
  }

  function refreshChannels() {
    if (!state.channels.length) return;
    song.tracks.forEach((t, i) => {
      if (state.channels[i]) applyChannel(t, state.channels[i]);
    });
  }

  function renderPads(t) {
    const def = ENG[t.engine];
    const grid = el('div', { class: 'pads' });
    def.pads.forEach((name, i) => {
      const hasSample = !!t.samples[i];
      const pad = el('div', {
        class: 'pad',
        onpointerdown: () => {
          liveDrum(i);
          pad.classList.add('on');
          setTimeout(() => pad.classList.remove('on'), 120);
          if (state.recording && state.playing) {
            recordPad(t, i);
          }
        },
      }, [
        el('span', { class: 'pad-name', text: name }),
        el('span', { class: 'pad-sample', text: hasSample ? 'WAV' : '' }),
        el('span', { class: 'pad-key', text: PAD_KEYS[i].toUpperCase() }),
      ]);
      pad.dataset.pad = i;
      grid.appendChild(pad);
    });
    return el('div', {}, [grid, el('div', { class: 'hint', style: { marginTop: '8px' }, text: 'Подушки пронумерованы 1–8. Свои сэмплы подставляются в те же каналы. Шаги — в своём секвенсоре ниже.' })]);
  }

  function renderKeyboard(t) {
    const keysBox = el('div', { class: 'keys' });
    const whites = [0, 2, 4, 5, 7, 9, 11];
    const blackAfter = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 };
    const octaves = [3, 4, 5];
    let wi = 0;
    const totalWhite = octaves.length * 7;
    const whiteW = 100 / totalWhite;

    octaves.forEach((oct) => {
      whites.forEach((semi) => {
        const midi = 12 * (oct + 1) + semi;
        const k = el('div', {
          class: 'key white', style: { left: wi * whiteW + '%', width: whiteW + '%' },
          'data-midi': midi,
        });
        attachKeyEvents(k, midi);
        keysBox.appendChild(k);
        if (blackAfter[semi] !== undefined) {
          const bm = 12 * (oct + 1) + blackAfter[semi];
          const bk = el('div', {
            class: 'key black',
            style: { left: (wi * whiteW + whiteW * 0.68) + '%', width: (whiteW * 0.62) + '%' },
            'data-midi': bm,
          });
          attachKeyEvents(bk, bm);
          keysBox.appendChild(bk);
        }
        wi++;
      });
    });
    return el('div', {}, [keysBox, el('div', { class: 'hint', style: { marginTop: '8px' }, text: 'Клавиатура: Z–M, Q–U. Клик по клавише играет ноту на выбранной машине.' })]);
  }

  function attachKeyEvents(node, midi) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      liveNoteOn(midi);
      node.classList.add('on');
      state.lastNote[state.activeTrack] = midi;
      if (state.recording && state.playing) recordNote(song.tracks[state.activeTrack], midi);
    });
    const up = () => { liveNoteOff(midi); node.classList.remove('on'); };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointerleave', up);
    node.addEventListener('pointercancel', up);
  }

  // ---------- отрисовка: секвенсор (редактор паттерна) ----------
  function gridRows() {
    const rows = [];
    song.tracks.forEach((t, ti) => {
      if (t.engine === 'beatbox') {
        ENG.beatbox.pads.forEach((p, pad) => {
          rows.push({ ti, pad, label: p, sub: 'BB' + (pad + 1), beatbox: true });
        });
      } else {
        rows.push({ ti, pad: null, label: t.name, sub: ENG[t.engine].name, beatbox: false });
      }
    });
    return rows;
  }

  function cellOn(row, step) {
    const t = song.tracks[row.ti];
    const pat = Pattern.pattern(t);
    if (row.beatbox) return (pat.pads || []).some((e) => e.at === step && e.p === row.pad);
    return (pat.notes || []).some((n) => n.at === step);
  }

  function toggleCell(row, step) {
    const t = song.tracks[row.ti];
    const pat = Pattern.pattern(t);
    if (row.beatbox) {
      const i = (pat.pads || []).findIndex((e) => e.at === step && e.p === row.pad);
      if (i >= 0) pat.pads.splice(i, 1); else pat.pads.push({ at: step, p: row.pad });
    } else {
      const i = pat.notes.findIndex((n) => n.at === step);
      if (i >= 0) {
        pat.notes.splice(i, 1);
      } else {
        const midi = state.lastNote[row.ti] || 60;
        pat.notes.push({ at: step, m: midi, len: 1, v: 0.85 });
      }
    }
    Pattern.markUsed(t);
    return cellOn(row, step);
  }

  /* Мини-превью паттерна для блока в банке */
  function miniBars(t, patIdx) {
    const pat = Pattern.pattern(t, patIdx);
    const bars = [];
    const bucket = Math.max(1, Math.ceil((t.patLen || 16) / 8));
    const items = (t.engine === 'beatbox' ? pat.pads : pat.notes) || [];
    for (let b = 0; b < 8; b++) {
      let h = 0;
      items.forEach((e) => {
        if (Math.floor(e.at / bucket) === b) h++;
      });
      bars.push(el('i', { style: { height: Math.min(16, 3 + h * 3) + 'px' } }));
    }
    return el('div', { class: 'pmini' }, bars);
  }

  function patternBar() {
    const t = song.tracks[state.activeTrack];
    if (!t) return el('div');
    Pattern.ensureTrack(t);
    const bar = el('div', { class: 'bank', style: { padding: '8px', border: 'none', background: 'transparent' } });

    // строка 1: слоты паттернов
    const slots = el('div', { class: 'bank-row' }, [
      el('div', { class: 'bank-label' }, [el('span', { text: 'Паттерн машины' })]),
      el('div', { class: 'pat-bar' }, [
        el('div', { class: 'pat-slots' }, [0, 1, 2, 3].map((i) =>
          el('button', {
            class: 'pat-slot' + (t.patIndex === i ? ' active' : '') + (t.used.indexOf(i) >= 0 ? ' used' : ''),
            text: 'ABCD'[i],
            title: 'Паттерн ' + 'ABCD'[i] + (t.used.indexOf(i) >= 0 ? ' — используется в аранжировке' : ''),
            onclick: () => {
              t.patIndex = i;
              Pattern.markUsed(t);
              renderSeq();
              renderMachine();
            },
          })
        )),
        el('button', { class: 'btn ghost', text: 'Копия A→B', style: { fontSize: '11px', padding: '6px 9px' }, onclick: copyPatternDialog }),
        el('button', { class: 'btn ghost', text: 'Очистить', style: { fontSize: '11px', padding: '6px 9px' }, onclick: () => { Pattern.clear(t); renderSeq(); UI.toast('Паттерн ' + 'ABCD'[t.patIndex] + ' очищен'); } }),
        el('span', { class: 'hint', text: 'шагов: ' + t.patLen + ' · тактов: ' + song.bars }),
      ]),
    ]);

    // строка 2: банк — 4 блока каждого трека
    const bankRow = el('div', { class: 'bank-row' }, [
      el('div', { class: 'bank-label' }, [el('span', { text: 'Банк паттернов' })]),
      el('div', { class: 'bank-blocks' }, [0, 1, 2, 3].map((i) =>
        el('div', {
          class: 'pblock' + (t.patIndex === i ? ' active' : ''),
          title: 'Паттерн ' + 'ABCD'[i] + ' — клик, чтобы редактировать',
          onclick: () => { t.patIndex = i; Pattern.markUsed(t); renderSeq(); renderMachine(); },
        }, [
          el('span', { class: 'pletter', text: 'ABCD'[i] }),
          t.used.indexOf(i) >= 0 ? el('span', { class: 'pmark', text: '●' }) : null,
          miniBars(t, i),
        ])
      )),
    ]);

    // строка 3: сцены — какие паттерны играют в каких тактах (для всех машин)
    const sceneRow = el('div', { class: 'bank-row', style: { alignItems: 'start' } }, [
      el('div', { class: 'bank-label' }, [el('span', { text: 'Сцены (аранжировка)' })]),
      el('div', { style: { display: 'grid', gap: '6px' } }, song.tracks.map((tr) => {
        Pattern.ensureTrack(tr);
        const blocks = [];
        for (let b = 0; b < song.arrangeBars; b++) {
          const letter = (tr.scenes || 'A').charAt(b) || 'A';
          blocks.push(el('div', {
            class: 'pblock' + (tr === t ? ' active' : ''),
            style: { height: '34px' },
            title: tr.name + ' · такт ' + (b + 1) + ' — нажмите, чтобы сменить паттерн',
            onclick: () => {
              const next = 'ABCD'[('ABCD'.indexOf(letter) + 1) % 4];
              const arr = (tr.scenes || 'A').padEnd(song.arrangeBars, 'A').split('');
              arr[b] = next;
              tr.scenes = arr.join('').slice(0, song.arrangeBars);
            },
          }, [
            el('span', { class: 'pletter', text: letter, style: { color: ENG[tr.engine].accent } }),
            el('span', { class: 'pletter', text: (b + 1) + ' такт', style: { fontSize: '8px' } }),
          ]));
        }
        return el('div', { class: 'chain' }, [
          el('span', { class: 'bank-label', style: { minWidth: '92px' }, text: tr.name }),
        ].concat(blocks));
      })),
    ]);

    bar.appendChild(slots);
    bar.appendChild(bankRow);
    bar.appendChild(sceneRow);
    return bar;
  }

  function copyPatternDialog() {
    const t = song.tracks[state.activeTrack];
    const row = el('div', { class: 'row' });
    [0, 1, 2, 3].forEach((from) => {
      [0, 1, 2, 3].forEach((to) => {
        if (from === to) return;
        row.appendChild(el('button', {
          class: 'btn ghost', text: 'ABCD'[from] + ' → ' + 'ABCD'[to],
          onclick: () => {
            Pattern.copyPattern(t, from, to);
            t.patIndex = to;
            Pattern.markUsed(t);
            renderSeq();
            UI.toast('Паттерн ' + 'ABCD'[to] + ' = копия ' + 'ABCD'[from]);
          },
        }));
      });
    });
    UI.modal('Копировать паттерн — ' + t.name, el('div', {}, [
      el('p', { class: 'muted', text: 'Удобно, когда нужно A (куплет) и B (припев) с одинаковой основой.' }),
      row,
    ]), [{ label: 'Закрыть' }]);
  }

  function renderSeq() {
    const grid = document.getElementById('seqGrid');
    const barBox = document.getElementById('patternBar');
    if (!grid) return;
    // на тач-устройствах сетку можно тянуть пальцем
    if (window.TouchUI) {
      const scroller = grid.parentElement;
      if (scroller) TouchUI.enableDragScroll(scroller);
      TouchUI.enableDragScroll(grid);
    }
    const steps = totalSteps();
    const t = song.tracks[state.activeTrack];
    Pattern.ensureTrack(t);
    applyTheme(ENG[t.engine].accent);

    if (barBox) {
      barBox.innerHTML = '';
      barBox.appendChild(patternBar());
    }

    const head = document.getElementById('seqTitle');
    if (head) head.textContent = 'Редактор паттерна ' + 'ABCD'[t.patIndex] + ' — ' + t.name;

    grid.innerHTML = '';
    state.lastPlayed = -1;
    grid.style.gridTemplateColumns = '108px repeat(' + steps + ', minmax(22px, 1fr))';
    // высота строк: мелодическим машинам — выше, чтобы попадать пальцем
    grid.style.setProperty('--row-h', rowHeightFor(t.engine) + 'px');
    grid.style.setProperty('--accent-track', ENG[t.engine].accent);

    grid.appendChild(el('div', { class: 'cell head-cell', style: { background: '#0f141c', cursor: 'default' } }));
    for (let s = 0; s < steps; s++) {
      const cls = ['cell', 'head-cell'];
      if (s % 4 === 0) cls.push('beat');
      if (s % song.steps === 0 && s > 0) cls.push('bar');
      grid.appendChild(el('div', { class: cls.join(' '), 'data-step': s }, s % 4 === 0
        ? [el('span', { style: { position: 'absolute', left: '3px', top: '3px', fontSize: '9px', color: '#5c6a80' }, text: String(Math.floor(s / (song.steps)) + 1) })]
        : []));
    }

    let prevTi = -1;
    gridRows().forEach((row) => {
      // каждая машина — отдельный блок со своей рамкой и своим цветом
      const tr = song.tracks[row.ti];
      const firstOfTrack = row.ti !== prevTi;
      prevTi = row.ti;
      const label = el('div', {
        class: 'grid-label' + (firstOfTrack ? ' group-start' : '')
          + (row.ti === state.activeTrack ? ' active' : ''),
        style: { borderLeftColor: ENG[tr.engine].accent },
        title: firstOfTrack ? tr.name + ' — свой секвенсор, паттерн ' + 'ABCD'[tr.patIndex] : row.sub,
      }, [
        el('span', { class: 'nm', text: row.label }),
        row.beatbox ? null : el('button', {
          class: 'btn ghost mute-mini', text: 'M',
          onclick: (e) => {
            e.stopPropagation();
            tr.mute = !tr.mute;
            refreshChannels();
            renderAll();
          },
        }),
      ]);
      label.addEventListener('click', () => {
        if (state.activeTrack === row.ti) return;
        state.activeTrack = row.ti;
        renderAll();
      });
      grid.appendChild(label);

      for (let s = 0; s < steps; s++) {
        const on = cellOn(row, s);
        const cls = ['cell'];
        if (s % 4 === 0) cls.push('beat');
        if (s % song.steps === 0 && s > 0) cls.push('bar');
        if (on) cls.push('on');
        if (on && s % 4 === 0) cls.push('strong');
        if (firstOfTrack) cls.push('group-start');
        const c = el('div', { class: cls.join(' '), 'data-step': s, 'data-track': row.ti, 'data-pad': row.pad == null ? '' : row.pad });
        c.addEventListener('click', (e) => {
          e.preventDefault();
          const switched = state.activeTrack !== row.ti;
          state.activeTrack = row.ti;
          if (switched) { renderTracklist(); renderMachine(); }
          const isOn = toggleCell(row, s);
          c.classList.toggle('on', isOn);
          c.classList.toggle('strong', isOn && s % 4 === 0);
          if (row.beatbox) {
            if (isOn) liveDrum(row.pad);
          } else {
            const tr = song.tracks[row.ti];
            const hit = Pattern.pattern(tr).notes.find((n) => n.at === s);
            if (hit) { state.lastNote[row.ti] = hit.m; liveNoteOn(hit.m); }
          }
          if (!switched) renderRollPanelOnly();
          else renderSeq();
        });
        c.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const tr = song.tracks[row.ti];
          const pat = Pattern.pattern(tr);
          if (row.beatbox) pat.pads = (pat.pads || []).filter((x) => !(x.at === s && x.p === row.pad));
          else pat.notes = pat.notes.filter((n) => n.at !== s);
          renderSeq();
        });
        grid.appendChild(c);
      }
    });
    renderRollPanelOnly();
  }

  function renderRollPanelOnly() {
    renderRoll();
  }

  /* Пиано-ролл внизу вкладки «Секвенсор» и внутри машины — один и тот же компонент */
  function renderRoll() {
    const panel = document.getElementById('rollPanel');
    if (!panel) return;
    const t = song.tracks[state.activeTrack];
    panel.innerHTML = '';
    if (!t) return;

    const head = el('div', { class: 'editor-head' }, [
      el('h4', { text: 'Свой секвенсор — ' + t.name + ' · паттерн ' + 'ABCD'[t.patIndex] }),
      el('span', { class: 'hint', text: 'Клик по пустому месту — новая нота · тяните ноту, чтобы двигать · за правый край — длина · жёлтая точка — громкость · правый клик — удалить' }),
    ]);
    panel.appendChild(head);

    if (t.engine === 'beatbox') {
      panel.appendChild(drumNotesInfo(t));
      return;
    }

    panel.appendChild(rollToolbar(t, () => { renderSeq(); }));
    // ролл живёт в отдельном контейнере: Pattern.mount очищает свой host
    // и иначе стирал бы заголовок и панель кнопок
    const rollHost = el('div', { class: 'roll-host' });
    panel.appendChild(rollHost);
    Pattern.mount(rollHost, t, {
      onChange: () => refreshSeqMiniState(),
      onPreview: (midi, v) => liveNoteOn(midi, v),
    });
  }

  /* Панель над роллом: масштаб дорожек и следование за транспортом.
     Настройки индивидуальные — у каждого синтезатора свои. */
  function rollToolbar(t, rerender) {
    const zoomBtn = el('button', {
      class: 'btn ghost mini',
      title: 'Высота дорожек: удобнее попадать пальцем по ноте',
      text: 'Клавиши ' + Pattern.zoomLabel(t),
      onclick: () => {
        Pattern.cycleZoom(t);
        rerender();
      },
    });
    const followBtn = el('button', {
      class: 'btn ghost mini' + (t.follow ? ' on' : ''),
      title: 'Ролл сам прокручивается к играющему такту',
      text: t.follow ? 'Следовать: вкл' : 'Следовать: выкл',
      onclick: () => {
        t.follow = !t.follow;
        followBtn.classList.toggle('on', t.follow);
        followBtn.textContent = t.follow ? 'Следовать: вкл' : 'Следовать: выкл';
      },
    });
    return el('div', { class: 'roll-toolbar' }, [
      zoomBtn,
      followBtn,
      el('button', {
        class: 'btn ghost mini',
        title: 'Удвоить: скопировать ноты на второй такт паттерна',
        text: '×2',
        onclick: () => { doubleNotes(t); rerender(); },
      }),
      el('button', {
        class: 'btn ghost mini',
        title: 'Сдвинуть ноты на один шаг вперёд',
        text: 'Сдвиг +1',
        onclick: () => { shiftNotes(t, 1); rerender(); },
      }),
      el('button', {
        class: 'btn ghost mini',
        title: 'Сдвинуть ноты на один шаг назад',
        text: 'Сдвиг −1',
        onclick: () => { shiftNotes(t, -1); rerender(); },
      }),
      el('button', {
        class: 'btn ghost mini',
        title: 'Транспонировать вверх на октаву',
        text: '+12',
        onclick: () => { transposeNotes(t, 12); rerender(); },
      }),
      el('button', {
        class: 'btn ghost mini',
        title: 'Транспонировать вниз на октаву',
        text: '−12',
        onclick: () => { transposeNotes(t, -12); rerender(); },
      }),
    ]);
  }

  /* У драм-машины свой секвенсор — это сетка по подушкам; показываем,
     что в паттерне реально записано, чтобы не было ощущения «пустого места». */
  function drumNotesInfo(t) {
    const pat = Pattern.pattern(t);
    const hits = (pat.pads || []).length;
    const pads = ENG.beatbox.pads;
    const perPad = pads.map((p, i) => ({
      name: p,
      n: (pat.pads || []).filter((e) => e.p === i).length,
    })).filter((x) => x.n);
    return el('div', { class: 'roll-toolbar drum-info' }, [
      el('span', { class: 'hint', text: hits ? 'Ударов в паттерне: ' + hits : 'Паттерн пуст — кликайте по сетке выше' }),
    ].concat(perPad.map((x) => el('span', { class: 'pill', text: x.name + ' ×' + x.n }))));
  }

  /* ---------- операции над нотами машины ---------- */
  function doubleNotes(t) {
    const pat = Pattern.pattern(t);
    const len = t.patLen;
    const half = Math.floor(len / 2);
    const copy = pat.notes.filter((n) => n.at + Pattern.notelen(n) <= half)
      .map((n) => ({ at: n.at + half, m: n.m, len: n.len, v: n.v }));
    if (!copy.length) { UI.toast('Нечего удваивать: в первой половине паттерна нет нот'); return; }
    pat.notes = pat.notes.concat(copy);
    Pattern.markUsed(t);
    Pattern.refresh(t);
    UI.toast('Ноты первого такта скопированы во второй (' + copy.length + ')');
  }

  function shiftNotes(t, dir) {
    const pat = Pattern.pattern(t);
    const len = t.patLen;
    let moved = 0;
    pat.notes.forEach((n) => {
      const at = n.at + dir;
      if (at >= 0 && at < len) { n.at = at; moved++; }
    });
    if (!moved) { UI.toast('Сдвигать некуда'); return; }
    Pattern.markUsed(t);
    Pattern.refresh(t);
    UI.toast('Ноты сдвинуты на ' + (dir > 0 ? '+1' : '−1') + ' шаг');
  }

  function transposeNotes(t, semis) {
    const pat = Pattern.pattern(t);
    if (!pat.notes.length) { UI.toast('В паттерне нет нот'); return; }
    pat.notes.forEach((n) => {
      n.m = Math.max(Pattern.ROLL_LO, Math.min(Pattern.ROLL_HI, n.m + semis));
    });
    Pattern.refresh(t);
    UI.toast('Транспонировано на ' + (semis > 0 ? '+' : '') + semis + ' полутонов');
  }

  /* Обновляет «горящие» ячейки сетки, не перерисовывая ролл */
  function refreshSeqMiniState() {
    const t = song.tracks[state.activeTrack];
    if (!t) return;
    gridRows().forEach((row) => {
      for (let s = 0; s < totalSteps(); s++) {
        const cell = document.querySelector('.cell[data-track="' + row.ti + '"][data-pad="' + (row.pad == null ? '' : row.pad) + '"][data-step="' + s + '"]');
        if (cell) {
          const on = cellOn(row, s);
          cell.classList.toggle('on', on);
          cell.classList.toggle('strong', on && s % 4 === 0);
        }
      }
    });
  }

  function renderMixer() {
    const box = document.getElementById('mixer');
    box.innerHTML = '';
    song.tracks.forEach((t, i) => {
      const def = ENG[t.engine];
      const strip = el('div', { class: 'strip' }, [
        el('h4', { text: t.name, style: { color: def.accent } }),
        el('div', { class: 'small', text: def.name }),
        el('input', {
          class: 'rng', type: 'range', min: '0', max: '1', step: '0.01', value: String(t.vol),
          oninput: (e) => { t.vol = Number(e.target.value); refreshChannels(); },
        }),
        el('span', { class: 'small', text: 'Громкость' }),
        el('input', {
          class: 'rng', type: 'range', min: '-1', max: '1', step: '0.01', value: String(t.pan),
          oninput: (e) => { t.pan = Number(e.target.value); refreshChannels(); },
        }),
        el('span', { class: 'small', text: 'Панорама' }),
        el('input', {
          class: 'rng', type: 'range', min: '0', max: '1', step: '0.01', value: String(t.delay),
          oninput: (e) => { t.delay = Number(e.target.value); refreshChannels(); },
        }),
        el('span', { class: 'small', text: 'Delay' }),
        el('input', {
          class: 'rng', type: 'range', min: '0', max: '1', step: '0.01', value: String(t.reverb),
          oninput: (e) => { t.reverb = Number(e.target.value); refreshChannels(); },
        }),
        el('span', { class: 'small', text: 'Reverb' }),
        el('button', {
          class: 'btn ghost', text: t.mute ? 'Вкл' : 'Mute', style: { fontSize: '11px', padding: '5px 9px' },
          onclick: (e) => { t.mute = !t.mute; refreshChannels(); renderAll(); },
        }),
      ]);
      box.appendChild(strip);
    });

    const master = el('div', { class: 'strip master' }, [
      el('h4', { text: 'Мастер' }),
      el('span', { class: 'small', text: 'EQ / лимитер' }),
      el('input', {
        class: 'rng', type: 'range', min: '-12', max: '12', step: '1', value: String(song.eq.low),
        oninput: (e) => { song.eq.low = Number(e.target.value); applyMaster(); },
      }),
      el('span', { class: 'small', text: 'Низ' }),
      el('input', {
        class: 'rng', type: 'range', min: '-12', max: '12', step: '1', value: String(song.eq.mid),
        oninput: (e) => { song.eq.mid = Number(e.target.value); applyMaster(); },
      }),
      el('span', { class: 'small', text: 'Середина' }),
      el('input', {
        class: 'rng', type: 'range', min: '-12', max: '12', step: '1', value: String(song.eq.high),
        oninput: (e) => { song.eq.high = Number(e.target.value); applyMaster(); },
      }),
      el('span', { class: 'small', text: 'Верх' }),
      el('input', {
        class: 'rng', type: 'range', min: '0', max: '1', step: '0.01', value: String(song.masterVol),
        oninput: (e) => { song.masterVol = Number(e.target.value); applyMaster(); },
      }),
      el('span', { class: 'small', text: 'Громкость' }),
      el('input', {
        class: 'rng', type: 'range', min: '0', max: '0.8', step: '0.01', value: String(song.feedback),
        oninput: (e) => { song.feedback = Number(e.target.value); if (state.mixer) state.mixer.setFeedback(song.feedback); },
      }),
      el('span', { class: 'small', text: 'Delay feedback' }),
      el('div', { class: 'meter tall' }, [el('i', { id: 'masterMeter' })]),
      el('button', { class: 'btn ghost', text: 'Сброс', style: { fontSize: '11px' }, onclick: () => { song.eq = { low: 0, mid: 0, high: 0 }; applyMaster(); renderAll(); } }),
    ]);
    box.appendChild(master);
  }

  function applyMaster() {
    if (!state.mixer) return;
    state.mixer.eqLow.gain.value = song.eq.low;
    state.mixer.eqMid.gain.value = song.eq.mid;
    state.mixer.eqHigh.gain.value = song.eq.high;
    state.mixer.masterGain.gain.value = song.masterVol;
  }

  function meterLoop() {
    const an = state.mixer && state.mixer.analyser;
    if (an) {
      const data = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
      const bar = document.getElementById('masterMeter');
      if (bar) bar.style.height = Math.min(100, peak * 130) + '%';
    }
    requestAnimationFrame(meterLoop);
  }

  // ---------- панели со сэмплами ----------
  function openSamplesDialog() {
    const t = song.tracks[state.activeTrack];
    if (!t) return;
    const box = el('div', {});
    box.appendChild(el('p', { class: 'muted', text: 'Загрузите свои WAV в каналы. Формат: несжатый PCM 8–32 бита, любая частота дискретизации (декодирует браузер). Декодирование поддерживает WAV/OGG/MP3 — всё, что умеет ваш браузер.' }));
    box.appendChild(el('p', { class: 'hint', text: 'Эти сэмплы сохраняются вместе с проектом в ZIP-архив (вкладка «Экспорт» → «Скачать .zip с сэмплами»).' }));

    const slots = t.engine === 'beatbox'
      ? ENG.beatbox.pads.map((n, i) => ({ name: n, key: i }))
      : [{ name: 'Основной сэмпл (WAV)', key: 'main' }];
    slots.forEach((slot) => {
      const name = slot.name;
      const i = slot.key;
      const input = el('input', {
        type: 'file', accept: 'audio/*', style: { display: 'none' },
        onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            const arr = await f.arrayBuffer();
            const ctx = ensureAudio();
            const buf = await ctx.decodeAudioData(arr.slice(0));
            const channels = [];
            for (let c = 0; c < buf.numberOfChannels; c++) channels.push(new Float32Array(buf.getChannelData(c)));
            t.samples[i] = { channels, sampleRate: buf.sampleRate, name: f.name };
            state.lastSample = { track: t.id, key: i, name: f.name };
            UI.toast('Сэмпл загружен: ' + name + ' — ' + f.name, 'ok');
            renderMachine();
            openSamplesDialog();
          } catch (err) {
            UI.toast('Не удалось декодировать файл: ' + f.name, 'error');
          }
        },
      });
      const row = el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
        el('span', { text: (typeof i === 'number' ? (i + 1) + '. ' : '') + name }),
        el('div', { class: 'row', style: { margin: 0 } }, [
          el('span', { class: 'pill' + (t.samples[i] ? ' ok' : ''), text: t.samples[i] ? t.samples[i].name.slice(0, 18) : 'пусто' }),
          el('button', { class: 'btn ghost', text: 'WAV…', onclick: () => input.click() }),
          el('button', { class: 'btn ghost', text: '✕', onclick: () => { delete t.samples[i]; renderMachine(); openSamplesDialog(); } }),
        ]),
        input,
      ]);
      box.appendChild(row);
    });
    UI.modal('Свои сэмплы — ' + t.name, box, [{ label: 'Готово', primary: true }]);
  }

  function openNoteDialog() { /* зарезервировано */ }

  function addMachineDialog() {
    const list = el('div', { class: 'row' });
    Object.keys(ENG).forEach((k) => {
      const d = ENG[k];
      list.appendChild(el('button', {
        class: 'btn', text: d.name, title: d.desc,
        onclick: () => {
          song.tracks.push(newTrack(k, d.name));
          resizePatterns(song);
          refreshChannelsRebuild();
          state.activeTrack = song.tracks.length - 1;
          renderAll();
          UI.toast('Добавлена машина: ' + d.name);
        },
      }));
    });
    UI.modal('Добавить машину', el('div', {}, [
      el('p', { class: 'muted', text: 'Каждая машина — отдельный канал микшера со своими эффект-посылками.' }),
      list,
    ]), [{ label: 'Закрыть' }]);
  }

  function refreshChannelsRebuild() {
    if (!state.ctx) return;
    // пересоздаём каналы под новый состав дорожек
    state.channels = song.tracks.map((t) => {
      const ch = AE.createChannel(state.ctx, state.mixer);
      applyChannel(t, ch);
      return ch;
    });
    applyFxRouting();
  }

  function removeTrack() {
    if (song.tracks.length <= 1) { UI.toast('Нельзя удалить последнюю машину', 'error'); return; }
    song.tracks.splice(state.activeTrack, 1);
    state.activeTrack = Math.max(0, state.activeTrack - 1);
    refreshChannelsRebuild();
    renderAll();
  }

  // ---------- Kaoss (X-Y пэд и процессор эффектов) ----------
  function renderKaoss() {
    const area = document.getElementById('kaossArea');
    const deckHost = document.getElementById('kaossDeckHost');
    if (!area) return;
    area.innerHTML = '';
    area.classList.remove('hidden-deck');

    if (!state.ctx) {
      area.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: 'Kaoss Deck' }),
        el('p', { class: 'muted', text: 'Два прибора рядом: Kaossilator (звук) и mini Kaoss Pad 2 (эффекты). Нажмите, чтобы создать аудио-движок.' }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn primary', text: 'Включить звук', onclick: () => { ensureAudio(); renderKaoss(); } }),
        ]),
      ]));
      return;
    }

    // два девайса рядом + LINK (если дека недоступна — старые панели как fallback)
    let deckOk = false;
    if (deckHost && window.KaossDeck) {
      try {
        KaossDeck.render(deckHost);
        deckOk = true;
      } catch (err) {
        console.error('KaossDeck:', err);
      }
    }
    if (!deckOk && deckHost) deckHost.innerHTML = '';

    if (deckHost && window.TouchUI) {
      deckHost.querySelectorAll('.xy-pad').forEach((p) => TouchUI.padMultiTouch(p));
    }

    if (!deckOk) {
      area.classList.remove('hidden-deck');
      area.appendChild(KaossUI.instrumentPanel(state.kaossInst, () => renderKaoss()));
      area.appendChild(KaossUI.fxPanel(state.kaossFX, state.mixer, () => renderKaoss()));
    }

    // доп. секции: маршрутизация FX и справка
    if (state.kaossFX) area.appendChild(fxRoutingCard());

    area.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Совместная работа двух девайсов' }),
      el('ul', { class: 'clean' }, [
        el('li', { text: 'Kaossilator: 25 звуков по категориям, X — нота по гамме, Y — тембр. Два лупа: своя запись (●) и готовые лупы звука (▶ луп).' }),
        el('li', { text: 'mini Kaoss Pad 2: 12 программ эффектов и плеер с pitch adjust. По умолчанию стоит на мастер-шине — обрабатывает и синтезатор тоже.' }),
        el('li', { text: 'LINK: одно движение по любому пэду двигает оба прибора — Kaossilator играет, miniKP2 одновременно открывает фильтр/эхо.' }),
        el('li', { text: 'REC XY: записывает движение пальца. «В ЛУП» превращает его в зацикленную фразу Kaossilator, «→ паттерн» переносит в проект.' }),
        el('li', { text: 'HOLD фиксирует позицию X-Y (у синтезатора держит ноту, у эффекта — глубину).' }),
        el('li', { text: 'MIDI: CC1/CC16 → X, CC2/CC17 → Y; ноты 36–43 на 10-м канале — слайсы.' }),
      ]),
    ]));
  }

  /* Карточка маршрутизации FX-процессора */
  function fxRoutingCard() {
    const box = el('div', { class: 'card' });
    box.appendChild(el('h3', { text: 'Куда врезать процессор' }));
    box.appendChild(el('p', { class: 'muted', text: 'По умолчанию miniKP2 стоит на мастер-шине. Можно врезать его в отдельные каналы — тогда эффект слышно только на них.' }));

    const row = el('div', { class: 'row' });
    row.appendChild(el('button', {
      class: 'btn' + (state.fxChannels.length === 0 ? ' primary' : ''),
      text: 'Мастер',
      onclick: () => { state.fxChannels = []; applyFxRouting(); renderKaoss(); },
    }));
    song.tracks.forEach((t, i) => {
      const on = state.fxChannels.indexOf(i) >= 0;
      row.appendChild(el('button', {
        class: 'btn' + (on ? ' primary' : ''),
        text: (i + 1) + '. ' + t.name,
        onclick: () => {
          const k = state.fxChannels.indexOf(i);
          if (k >= 0) state.fxChannels.splice(k, 1); else state.fxChannels.push(i);
          applyFxRouting();
          renderKaoss();
        },
      }));
    });
    box.appendChild(row);
    box.appendChild(el('p', { class: 'muted', style: { marginTop: '8px' }, text: state.fxChannels.length ? 'Процессор врезан в выбранные каналы.' : 'Процессор работает на мастер-шине (вся студия).' }));
    return box;
  }

  function applyFxRouting() {
    const fx = state.kaossFX;
    if (!fx || !state.mixer || !state.channels.length) return;
    state.channels.forEach((ch) => {
      AE.setChannelFX(ch, state.mixer, null);
    });
    if (!fx.output.__wired) {
      fx.output.connect(state.mixer.input);
      fx.output.__wired = true;
    }
    if (!state.fxChannels.length) {
      state.channels.forEach((ch) => AE.setChannelFX(ch, state.mixer, fx.input));
    } else {
      state.fxChannels.forEach((i) => {
        if (state.channels[i]) AE.setChannelFX(state.channels[i], state.mixer, fx.input);
      });
    }
  }

  // ---------- MIDI ----------
  function initMidi() {
    if (!navigator.requestMIDIAccess) {
      UI.toast('Web MIDI не поддерживается этим браузером (нужен Chrome/Edge/Opera)', 'error');
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then(onMidiSuccess).catch(() => {
      UI.toast('Доступ к MIDI отклонён', 'error');
    });
  }

  function onMidiSuccess(access) {
    state.midiAccess = access;
    setMidiStatus();
    access.onstatechange = () => {
      setMidiStatus();
      bindMidiHandlers();
      refreshMidiOutSelect();
    };
    bindMidiHandlers();
    refreshMidiOutSelect();
    UI.toast('MIDI подключён. Для игры в Nexus выберите порт вывода ниже.', 'ok');
  }

  function bindMidiHandlers() {
    const access = state.midiAccess;
    if (!access) return;
    Array.from(access.inputs.values()).forEach((input) => {
      input.onmidimessage = (e) => onMidiMessage(e, true);
    });
  }

  /* --- MIDI-выход: шлём партии проекта в DAW, где открыт Nexus --- */
  function midiOut() {
    const access = state.midiAccess;
    if (!access || !access.outputs) return null;
    const id = state.midiOutId;
    if (id) return access.outputs.get(id) || null;
    return null;
  }

  function refreshMidiOutSelect() {
    const sel = document.getElementById('midiOut');
    if (!sel) return;
    const access = state.midiAccess;
    const names = access && access.outputs ? Array.from(access.outputs.values()) : [];
    sel.innerHTML = '';
    const off = el('option', { value: '', text: names.length ? 'выкл' : 'портов вывода нет' });
    sel.appendChild(off);
    names.forEach((o) => {
      sel.appendChild(el('option', { value: o.id, text: o.name + (o.manufacturer ? ' · ' + o.manufacturer : '') }));
    });
    const keep = state.midiOutId && names.some((n) => n.id === state.midiOutId);
    sel.value = keep ? state.midiOutId : '';
  }

  function sendMidi(msg) {
    const out = midiOut();
    if (!out) return false;
    try { out.send(msg); return true; } catch (e) { return false; }
  }

  /* Отправка ноты/удара с канала машины */
  function sendTrackNote(t, midi, velocity, durationMs, pad) {
    if (!midiOut()) return;
    const ch = state.midiOutChannel;
    let note = midi;
    let chan = ch;
    if (pad != null) {
      const GM = [36, 38, 42, 46, 39, 45, 47, 37];
      note = GM[pad] != null ? GM[pad] : 36;
      chan = 9;
    }
    const vel = Math.max(1, Math.min(127, Math.round((velocity != null ? velocity : 0.85) * 127)));
    sendMidi([0x90 | chan, note & 127, vel]);
    setTimeout(() => { sendMidi([0x80 | chan, note & 127, 0]); }, Math.max(25, durationMs || 150));
  }

  function sendClockStart() {
    if (!midiOut()) return;
    sendMidi([0xfa]); // Start
  }

  function sendClockStop() {
    if (!midiOut()) return;
    sendMidi([0xfc]);
  }

  function setMidiStatus() {
    const access = state.midiAccess;
    const pill = document.getElementById('midiStatus');
    const btn = document.getElementById('btnMidi2');
    if (!access) {
      pill.textContent = 'не подключено';
      pill.className = 'pill';
      return;
    }
    const names = Array.from(access.inputs.values()).map((i) => i.name);
    state.midiInputs = names;
    if (names.length) {
      pill.textContent = names.join(', ');
      pill.className = 'pill ok';
      btn.textContent = 'MIDI готов';
    } else {
      pill.textContent = 'портов не найдено';
      pill.className = 'pill';
    }
    const log = document.getElementById('midiLog');
    if (log) log.textContent = 'Порты: ' + (names.join(', ') || '—') + '\n';
  }

  function midiLog(line) {
    const log = document.getElementById('midiLog');
    if (!log) return;
    log.textContent = (log.textContent + line + '\n').split('\n').slice(-12).join('\n');
    log.scrollTop = log.scrollHeight;
  }

  function onMidiMessage(e) {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    if (handleKaossMidi(cmd, d1, d2, status & 0x0f)) return;
    if (cmd === 0x90 && d2 > 0) {
      liveNoteOn(d1, d2 / 127, true);
      markKey(d1, true);
      midiLog('NoteOn  ch' + ch + ' ' + Pattern.noteName(d1) + ' vel ' + d2);
      if (state.recording && state.playing) {
        recordNote(song.tracks[state.activeTrack], d1, d2 / 127);
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      liveNoteOff(d1);
      markKey(d1, false);
      midiLog('NoteOff ch' + ch + ' ' + Pattern.noteName(d1));
    } else if (cmd === 0xb0) {
      midiLog('CC ' + d1 + ' = ' + d2);
      if (d1 === 1) {
        // модуляция: меняем срез (если есть)
        const t = song.tracks[state.activeTrack];
        const def = ENG[t.engine];
        if (def.params.some((p) => p.k === 'cutoff')) {
          t.params.cutoff = 200 + (d2 / 127) * 9000;
          refreshLiveParams();
          renderMachine();
        }
      }
    }
  }

  /* MIDI-управление Kaoss: CC1/CC2 = X/Y, ноты включают сэмплы */
  function bindKaossMidi() {
    state.kaossMidi = { x: 0.5, y: 0.5 };
  }

  function handleKaossMidi(cmd, d1, d2, chan) {
    if (!state.kaossMidi) return false;
    const K = window.Kaoss;
    if (cmd === 0xb0 && (d1 === 1 || d1 === 2 || d1 === 16 || d1 === 17)) {
      // CC1/CC16 → X, CC2/CC17 → Y
      if (d1 === 1 || d1 === 16) state.kaossMidi.x = d2 / 127;
      else state.kaossMidi.y = d2 / 127;
      if (state.kaossFX) state.kaossFX.setXY(state.kaossMidi.x, state.kaossMidi.y);
      const inst = state.kaossInst;
      if (inst && inst.mode === 'sampler') inst.sampler && inst.sampler.play(state.kaossMidi.x, state.kaossMidi.y, 0.9, null);
      const pad = document.querySelectorAll('.xy-pad')[1];
      if (pad) pad.setXY(state.kaossMidi.x, state.kaossMidi.y);
      midiLog('Kaoss XY: ' + Math.round(state.kaossMidi.x * 100) + ' / ' + Math.round(state.kaossMidi.y * 100));
      return true;
    }
    if (cmd === 0x90 && chan === 9 && state.kaossInst && state.kaossInst.sampler) {
      // ноты 36..43 на 10-м канале — слайсы 1..8
      const idx = d1 - 36;
      if (idx >= 0 && idx < 8) {
        const n = state.kaossInst.sampler.slices.length || 1;
        state.kaossInst.sampler.play((idx + 0.5) / n, 0.8, d2 / 127, null);
        return true;
      }
    }
    return false;
  }

  function markKey(midi, on) {
    document.querySelectorAll('.key[data-midi="' + midi + '"]').forEach((k) => {
      k.classList.toggle('on', on);
    });
  }

  // ---------- экспорт / импорт ----------
  function buildEvents(barsFrom, barsTo) {
    const events = [];
    const stepDur = 60 / song.bpm / 4;
    const spb = song.steps;
    let t = 0;
    for (let bar = barsFrom; bar < barsTo; bar++) {
      for (let s = 0; s < spb; s++) {
        const patBar = bar % Math.max(1, song.bars);
        const patStep = patBar * spb + s;
        song.tracks.forEach((tr, ci) => {
          if (tr.mute) return;
          const letter = (tr.scenes || 'A').charAt(bar) || 'A';
          const idx = 'ABCD'.indexOf(letter);
          const pat = Pattern.pattern(tr, idx < 0 ? 0 : idx);
          if (tr.engine === 'beatbox') {
            (pat.pads || []).forEach((e) => {
              if (e.at !== patStep) return;
              events.push({
                engine: 'beatbox', params: tr.params, pad: e.p, channel: ci,
                velocity: 0.95, time: t, duration: stepDur,
                sample: tr.samples[e.p] || null,
              });
            });
          } else {
            const smp = ENG[tr.engine].sampler ? (tr.samples.main || null) : null;
            (pat.notes || []).forEach((n) => {
              if (n.at !== patStep) return;
              events.push({
                engine: tr.engine, params: tr.params, midi: n.m, channel: ci,
                velocity: n.v != null ? n.v : 0.85, time: t,
                duration: stepDur * Math.max(1, Pattern.notelen(n)) * 0.95,
                sample: smp,
              });
            });
          }
        });
        t += stepDur;
      }
    }
    return events;
  }

  /* ---------- рендер аранжировки (общий для WAV/MP3) ---------- */
  let rendering = false;

  function renderProject(opts) {
    opts = opts || {};
    const status = document.getElementById('renderStatus');
    const info = document.getElementById('renderInfo');
    const fill = (pct, text) => {
      if (!status) return;
      status.innerHTML = '';
      status.appendChild(el('i', { style: { width: Math.max(2, Math.min(100, pct)) + '%' } }));
      if (info) info.textContent = text || '';
    };

    if (rendering) { UI.toast('Рендер уже идёт — дождитесь готовности', 'error'); return; }
    const events = buildEvents(0, song.arrangeBars);
    if (!events.length) { UI.toast('Секвенсор пуст — нечего рендерить', 'error'); return; }

    const total = (60 / song.bpm / 4) * song.steps * song.arrangeBars;
    const renderSong = {
      bpm: song.bpm,
      eq: song.eq,
      masterVol: song.masterVol,
      feedback: song.feedback,
      tracks: song.tracks.map((t) => ({
        vol: t.mute ? 0 : t.vol, pan: t.pan, delay: t.delay, reverb: t.reverb,
      })),
      events,
    };

    rendering = true;
    fill(8, 'рендер ' + song.arrangeBars + ' такт(ов)…');
    UI.toast(opts.to === 'mp3' ? 'Рендерю и кодирую MP3…' : 'Рендерю WAV…');

    return AE.renderToBuffer(renderSong, total, 44100).then((buffer) => {
      fill(62, 'аудио готово: ' + buffer.duration.toFixed(1) + ' с');
      const stem = opts.name || ('mini-studio-' + Date.now());
      if (opts.to === 'wav') {
        const blob = AE.encodeWav(buffer);
        UI.download(blob, stem + '.wav');
        fill(100, 'WAV: ' + (blob.size / 1048576).toFixed(1) + ' МБ · ' + buffer.duration.toFixed(1) + ' с');
        UI.toast('WAV готов: ' + song.arrangeBars + ' такт(ов), ' + (blob.size / 1048576).toFixed(1) + ' МБ', 'ok');
        return { blob, buffer };
      }
      if (!window.ExportMp3) throw new Error('Модуль MP3 не загружен (js/export-mp3.js)');
      const kbpsSel = document.getElementById('mp3kbps');
      const kbps = kbpsSel ? Number(kbpsSel.value) || 192 : 192;
      return window.ExportMp3.encodeBuffer(buffer, {
        kbps,
        onProgress: (p) => fill(62 + p * 36, 'кодирую MP3 ' + Math.round(p * 100) + '% · ' + kbps + ' кбит/с…'),
      }).then((blob) => {
        UI.download(blob, stem + '.mp3');
        fill(100, 'MP3: ' + (blob.size / 1048576).toFixed(2) + ' МБ · ' + kbps + ' кбит/с · ' + buffer.duration.toFixed(1) + ' с');
        UI.toast('MP3 готов: ' + (blob.size / 1048576).toFixed(2) + ' МБ, ' + kbps + ' кбит/с', 'ok');
        return { blob, buffer };
      });
    }).catch((err) => {
      console.error(err);
      fill(0, '');
      UI.toast('Ошибка рендера: ' + err.message, 'error');
    }).then((res) => { rendering = false; return res; });
  }

  function exportWav() {
    return renderProject({ to: 'wav' });
  }

  function exportMp3() {
    return renderProject({ to: 'mp3' });
  }

  /* Состояние Kaoss-деки (звук, гамма, октава, FX-программа, записанные лупы) */
  function kaossSnapshot() {
    const inst = state.kaossInst;
    const fx = state.kaossFX;
    if (!inst && !fx) return null;
    return {
      prog: inst ? inst.prog : 0,
      scale: inst ? inst.scale : 'pentaMin',
      octave: inst ? inst.octave : 4,
      bpm: inst ? inst.bpm : song.bpm,
      loops: inst ? inst.loops.map((l) => (Array.isArray(l) ? l : null)) : [null, null],
      fxProgram: fx ? fx.program : 0,
      fxHold: fx ? !!fx.hold : false,
    };
  }

  let pendingKaoss = null;

  function applyKaossState(ks) {
    if (!ks) return;
    const inst = state.kaossInst;
    const fx = state.kaossFX;
    if (inst) {
      if (ks.prog != null) inst.setProgram(ks.prog);
      if (ks.scale) inst.scale = ks.scale;
      if (ks.octave != null) inst.octave = ks.octave;
      if (ks.bpm) inst.bpm = ks.bpm;
      if (Array.isArray(ks.loops)) {
        ks.loops.forEach((l, i) => { inst.loops[i] = Array.isArray(l) ? l : null; });
      }
    }
    if (fx && ks.fxProgram != null) fx.setProgram(ks.fxProgram);
  }

  /* ---------- ZIP: проект вместе со своими сэмплами ---------- */
  const SAMPLES_DIR = 'samples/';

  /* имя файла в архиве: без расширения, безопасное для файловой системы */
  function sampleFile(prefix, name) {
    const bare = String(name || 'sample').replace(/\.[a-z0-9]{1,5}$/i, '');
    return SAMPLES_DIR + prefix + '_' + PIO.asciiName(bare, 'sample') + '.wav';
  }

  /* Собираем список всех сэмплов проекта: каналы, Kaossilator, плеер miniKP2 */
  function collectSamples() {
    const items = [];
    song.tracks.forEach((t) => {
      Object.keys(t.samples || {}).forEach((key) => {
        const smp = t.samples[key];
        if (!smp || !smp.channels) return;
        items.push({
          kind: 'channel', trackId: t.id, trackName: t.name, key, smp,
          file: SAMPLES_DIR + PIO.sanitizeName('track_' + t.id + '_' + key) + '_'
            + PIO.asciiName(String((t.samples[key].name || key)).replace(/\.[a-z0-9]{1,5}$/i, ''), String(key)) + '.wav',
        });
      });
    });
    const inst = state.kaossInst;
    if (inst && inst.sampler && inst.sampler.buffer) {
      items.push({
        kind: 'kaoss', smp: {
          channels: (() => {
            const b = inst.sampler.buffer;
            const chans = [];
            for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
            return chans;
          })(),
          sampleRate: inst.sampler.buffer.sampleRate,
          name: inst.sampler.name,
        },
        file: sampleFile('kaoss', inst.sampler.name),
      });
    }
    const fx = state.kaossFX;
    if (fx && fx.player && fx.player.buffer) {
      items.push({
        kind: 'player', smp: {
          channels: (() => {
            const b = fx.player.buffer;
            const chans = [];
            for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
            return chans;
          })(),
          sampleRate: fx.player.buffer.sampleRate,
          name: fx.player.name,
        },
        file: sampleFile('player', fx.player.name),
      });
    }
    return items;
  }

  function sampleManifest(items) {
    return items.map((it) => {
      if (it.kind === 'channel') {
        return { kind: 'channel', trackId: it.trackId, key: it.key, file: it.file, name: it.smp.name || '' };
      }
      return { kind: it.kind, file: it.file, name: it.smp.name || '' };
    });
  }

  function saveProjectZip() {
    if (!window.ProjectIO) { UI.toast('Модуль архива не загружен (js/project-io.js)', 'error'); return; }
    const items = collectSamples();
    const data = serialize();
    data.sampleManifest = sampleManifest(items);
    const files = [{
      name: 'project.json',
      bytes: new TextEncoder().encode(JSON.stringify(data, null, 2)),
      compress: true,
    }];
    items.forEach((it) => {
      files.push({ name: it.file, bytes: PIO.audioToWav(it.smp) });
    });
    files.push({
      name: 'README.txt',
      compress: true,
      bytes: new TextEncoder().encode(
        'Mini Studio — проект вместе со своими сэмплами.\n\n'
        + 'project.json — ноты, банки A–D, сцены, микшер, BPM, состояние Kaoss-деки.\n'
        + 'samples/ — свои сэмплы в WAV 16 бит (каналы, Kaossilator, плеер miniKP2).\n\n'
        + 'Открыть: в студии вкладка «Экспорт» → «Открыть .zip».\n'
        + 'Файл сделан локально в браузере, ничего никуда не отправлялось.\n'),
    });
    return PIO.packFiles(files).then((blob) => {
      const nameInput = document.getElementById('projName');
      const base = PIO.sanitizeName((nameInput && nameInput.value.trim()) || 'mini-studio-project');
      UI.download(blob, base + '.zip');
      const mb = (blob.size / 1048576).toFixed(2);
      UI.toast('Архив готов: ' + items.length + ' сэмпл(ов), ' + mb + ' МБ', 'ok');
      const info = document.getElementById('renderInfo');
      if (info) info.textContent = 'ZIP: project.json + ' + items.length + ' сэмпл(ов) · ' + mb + ' МБ';
      return { blob, items: items.length };
    });
  }

  /* Открыть .zip: project.json + samples/ → проект и сэмплы на своих местах */
  function openProjectZip(file) {
    if (!window.ProjectIO) { UI.toast('Модуль архива не загружен', 'error'); return; }
    const status = document.getElementById('renderInfo');
    const setStatus = (t) => { if (status) status.textContent = t; };
    setStatus('читаю архив ' + file.name + '…');
    file.arrayBuffer().then((ab) => PIO.readZip(ab)).then((entries) => {
      const decoder = new TextDecoder('utf-8');
      const jsonEntry = entries.find((e) => /(^|\/)project\.json$/i.test(e.name));
      if (!jsonEntry) throw new Error('В архиве нет project.json');
      const obj = JSON.parse(decoder.decode(jsonEntry.bytes));
      const manifest = obj.sampleManifest || [];
      delete obj.sampleManifest;
      loadProject(obj);
      if (!manifest.length) {
        setStatus('проект загружен, сэмплов в архиве нет');
        UI.toast('Проект загружен из архива (без сэмплов)', 'ok');
        return { restored: 0, total: 0 };
      }
      setStatus('ставлю сэмплы: 0/' + manifest.length + '…');
      const ctx = ensureAudio();
      let restored = 0;
      let done = 0;
      const queue = () => manifest.reduce((chain, item) => chain.then(() => {
        const entry = entries.find((e) => e.name === item.file);
        done++;
        if (!entry) { setStatus('сэмплы: ' + done + '/' + manifest.length); return null; }
        return PIO.bytesToAudioBuffer(ctx, entry.bytes).then((buf) => {
          if (item.kind === 'channel') {
            const tr = song.tracks.find((t) => t.id === item.trackId);
            if (tr) {
              const channels = [];
              for (let c = 0; c < buf.numberOfChannels; c++) channels.push(new Float32Array(buf.getChannelData(c)));
              tr.samples[item.key] = { channels, sampleRate: buf.sampleRate, name: item.name || 'sample.wav' };
              restored++;
            }
          } else if (item.kind === 'kaoss' && state.kaossInst) {
            state.kaossInst.loadSample(buf, item.name || 'sample.wav');
            restored++;
          } else if (item.kind === 'player' && state.kaossFX) {
            state.kaossFX.loadAudio(buf, item.name || 'sample.wav');
            restored++;
          }
          setStatus('сэмплы: ' + done + '/' + manifest.length);
          return null;
        }).catch((err) => {
          console.warn('сэмпл из архива не прочитан:', item.file, err);
        });
      }), Promise.resolve());
      return queue().then(() => {
        renderMachine();
        renderKaoss();
        renderProjectList();
        setStatus('архив открыт: ' + restored + ' из ' + manifest.length + ' сэмпл(ов)');
        UI.toast('Проект и сэмплы загружены: ' + restored + '/' + manifest.length, 'ok');
        return { restored, total: manifest.length };
      });
    }).catch((err) => {
      console.error(err);
      setStatus('');
      UI.toast('Не удалось открыть архив: ' + err.message, 'error');
    });
  }

  function serialize() {
    return JSON.parse(JSON.stringify({
      kaoss: kaossSnapshot(),
      bpm: song.bpm, steps: song.steps, bars: song.bars,
      arrangeBars: song.arrangeBars, feedback: song.feedback,
      masterVol: song.masterVol, eq: song.eq,
      tracks: song.tracks.map((t) => ({
        id: t.id, engine: t.engine, name: t.name, vol: t.vol, pan: t.pan,
        delay: t.delay, reverb: t.reverb, mute: t.mute, params: t.params,
        bank: t.bank, patIndex: t.patIndex, used: t.used, scenes: t.scenes,
        // вид своего секвенсора: у каждой машины свой масштаб и следование
        follow: t.follow, rollZoom: t.rollZoom, rollCollapsed: t.rollCollapsed,
      })),
    }));
  }

  function exportMidi() {
    const bars = song.arrangeBars || 4;
    const events = MidiFile.eventsFromSong(song, Pattern, bars);
    if (!events.length) { UI.toast('Секвенсор пуст — нечего экспортировать', 'error'); return; }
    const bytes = MidiFile.build(song, events, { ppq: 480 });
    UI.download(new Blob([bytes], { type: 'audio/midi' }), 'mini-studio-' + Date.now() + '.mid');
    UI.toast('MIDI готов: ' + song.tracks.length + ' дорожек, ' + events.length + ' нот, ' + bars + ' такт(ов). Откройте в DAW и назначьте инструмент Nexus.', 'ok');
  }

  /* ---------- сохранения проектов: слоты в браузере + файлы ---------- */
  const SLOTS_KEY = 'mini-studio-slots-v1';
  const SLOT_LIMIT = 20;

  function readSlots() {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeSlots(list) {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(list.slice(0, SLOT_LIMIT)));
      return true;
    } catch (e) {
      UI.toast('Не хватает места в браузере — сохраните проект в файл', 'error');
      return false;
    }
  }

  function projectSummary(obj) {
    const notes = (obj.tracks || []).reduce((sum, t) => sum
      + (Array.isArray(t.bank) ? t.bank.reduce((s2, b) => s2 + ((b.notes || []).length), 0) : (t.notes || []).length), 0);
    return {
      bpm: obj.bpm, bars: obj.arrangeBars, tracks: (obj.tracks || []).length, notes,
    };
  }

  function saveToSlot(name, opts) {
    opts = opts || {};
    const data = serialize();
    const list = readSlots();
    const title = (name || '').trim() || ('Проект ' + new Date().toLocaleString('ru-RU'));
    list.unshift({
      id: 'p' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: title,
      savedAt: Date.now(),
      data,
    });
    if (writeSlots(list)) {
      renderProjectList();
      if (!opts.quiet) UI.toast('Сохранено в браузер: ' + title, 'ok');
    }
  }

  function saveProject() {
    const clean = serialize();
    try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); } catch (e) {}
    const nameInput = document.getElementById('projName');
    const base = (nameInput && nameInput.value.trim()) || 'mini-studio-project';
    UI.download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }),
      base.replace(/[^\wа-яА-ЯёЁ \-]/g, '').trim().replace(/\s+/g, '-') + '.json');
    UI.toast('Проект сохранён (в файл и в браузер)', 'ok');
  }

  function loadSlot(slot) {
    try {
      loadProject(JSON.parse(JSON.stringify(slot.data)));
      UI.toast('Загружено: ' + slot.name, 'ok');
      const nameInput = document.getElementById('projName');
      if (nameInput) nameInput.value = slot.name;
    } catch (e) {
      UI.toast('Повреждённое сохранение: ' + e.message, 'error');
    }
  }

  function deleteSlot(id) {
    const list = readSlots().filter((s) => s.id !== id);
    writeSlots(list);
    renderProjectList();
    UI.toast('Сохранение удалено');
  }

  function renameSlot(slot) {
    const name = window.prompt('Новое название сохранения', slot.name);
    if (name == null) return;
    const list = readSlots();
    const item = list.find((s) => s.id === slot.id);
    if (!item) return;
    item.name = name.trim() || item.name;
    writeSlots(list);
    renderProjectList();
  }

  function downloadSlot(slot) {
    UI.download(new Blob([JSON.stringify(slot.data, null, 2)], { type: 'application/json' }),
      'mini-studio-' + slot.name.replace(/[^\wа-яА-ЯёЁ \-]/g, '').trim().replace(/\s+/g, '-') + '.json');
    UI.toast('Файл проекта скачивается', 'ok');
  }

  function renderProjectList() {
    const host = document.getElementById('projList');
    if (!host) return;
    host.innerHTML = '';
    const list = readSlots();
    if (!list.length) {
      host.appendChild(el('p', { class: 'hint', text: 'Сохранений в браузере пока нет — нажмите «Сохранить в браузер».' }));
      return;
    }
    list.forEach((slot) => {
      const sum = projectSummary(slot.data || {});
      const when = new Date(slot.savedAt || Date.now());
      host.appendChild(el('div', { class: 'proj-row' }, [
        el('div', { class: 'proj-main' }, [
          el('div', { class: 'proj-name', text: slot.name }),
          el('div', { class: 'proj-meta', text: when.toLocaleString('ru-RU') + ' · ' + sum.tracks + ' дор. · '
            + sum.notes + ' нот · ' + sum.bpm + ' BPM · ' + sum.bars + ' такт.' }),
        ]),
        el('div', { class: 'proj-actions' }, [
          el('button', { class: 'btn mini primary', text: 'Открыть', onclick: () => loadSlot(slot) }),
          el('button', { class: 'btn mini', text: 'Имя', onclick: () => renameSlot(slot) }),
          el('button', { class: 'btn mini', text: '.json', title: 'Скачать файлом', onclick: () => downloadSlot(slot) }),
          el('button', { class: 'btn mini ghost', text: '✕', title: 'Удалить', onclick: () => deleteSlot(slot.id) }),
        ]),
      ]));
    });
  }

  function autoSaveState(text, ok) {
    const p = document.getElementById('autosaveState');
    if (!p) return;
    p.textContent = text;
    p.className = 'pill' + (ok ? ' ok' : '');
  }

  function loadProject(obj) {
    if (!obj || !Array.isArray(obj.tracks)) throw new Error('Неверный формат проекта');
    song = {
      bpm: obj.bpm || 120,
      steps: obj.steps || 16,
      bars: obj.bars || 1,
      arrangeBars: obj.arrangeBars || 4,
      patternLen: (obj.steps || 16) * (obj.bars || 1),
      feedback: obj.feedback != null ? obj.feedback : 0.35,
      masterVol: obj.masterVol != null ? obj.masterVol : 0.85,
      eq: obj.eq || { low: 0, mid: 0, high: 0 },
      tracks: obj.tracks.map((t) => {
        const nt = newTrack(t.engine in ENG ? t.engine : 'subsynth', t.name || 'Машина', t.params);
        nt.id = t.id || uid();
        nt.vol = t.vol != null ? t.vol : 0.8;
        nt.pan = t.pan || 0;
        nt.delay = t.delay || 0;
        nt.reverb = t.reverb != null ? t.reverb : 0.1;
        nt.mute = !!t.mute;
        nt.params = Object.assign(window.defaultParams(nt.engine), t.params || {});
        Pattern.ensureTrack(nt);
        if (Array.isArray(t.bank)) {
          nt.bank = t.bank.map((b) => ({
            notes: Pattern.normalizeNotes(b.notes, nt.patLen),
            pads: Pattern.normalizePads(b.pads, nt.patLen),
          }));
          while (nt.bank.length < 4) nt.bank.push({ notes: [], pads: [] });
        } else {
          // старый формат: pat[] и notes[]
          const b = nt.bank[0];
          b.notes = Pattern.normalizeNotes(t.notes, nt.patLen);
          b.pads = Pattern.normalizePads(t.pat, nt.patLen);
        }
        nt.patIndex = t.patIndex || 0;
        nt.used = Array.isArray(t.used) && t.used.length ? t.used.slice() : [nt.patIndex];
        nt.scenes = typeof t.scenes === 'string' ? t.scenes : 'A'.repeat(song.arrangeBars);
        // настройки вида, свои у каждой машины
        nt.follow = t.follow !== false;
        nt.rollZoom = Number(t.rollZoom) > 0 ? UI.clamp(Number(t.rollZoom), 0.7, 1.8) : 1;
        nt.rollCollapsed = !!t.rollCollapsed;
        return nt;
      }),
    };
    resizePatterns(song);
    pendingKaoss = obj.kaoss || null;
    if (state.kaossInst || state.kaossFX) applyKaossState(pendingKaoss);
    state.activeTrack = Math.min(state.activeTrack, song.tracks.length - 1);
    document.getElementById('bpm').value = song.bpm;
    document.getElementById('stepCount').value = String(song.steps);
    document.getElementById('loopBars').value = String(song.arrangeBars);
    refreshChannelsRebuild();
    applyMaster();
    renderAll();
  }

  // ---------- демо ----------
  function demoSong() {
    const s = emptySong();
    s.bpm = 124;
    s.steps = 16;
    s.bars = 1;
    s.arrangeBars = 4;
    s.patternLen = 16;

    const bb = s.tracks[0];
    bb.params = Object.assign(window.defaultParams('beatbox'), { tune: 0, decay: 1.1, snap: 0.6, level: 0.95 });
    bb.vol = 0.95;
    const bass = s.tracks[1];
    bass.params = Object.assign(window.defaultParams('bassline'), ENG.bassline.presets[1].values);
    bass.vol = 0.8;
    bass.reverb = 0.05;
    const syn = s.tracks[2];
    syn.params = Object.assign(window.defaultParams('subsynth'), ENG.subsynth.presets[3].values);
    syn.vol = 0.55;
    syn.reverb = 0.22;
    syn.delay = 0.18;

    const padTrack = newTrack('padsynth', 'Пэд', ENG.padsynth.presets[1].values);
    padTrack.vol = 0.45;
    padTrack.reverb = 0.4;
    const keys = newTrack('fmsynth', 'Клавиши', ENG.fmsynth.presets[1].values);
    keys.vol = 0.5;
    keys.reverb = 0.25;
    keys.delay = 0.12;
    s.tracks.push(padTrack, keys);
    resizePatterns(s);

    const A = (t) => Pattern.pattern(t, 0);
    const B = (t) => Pattern.pattern(t, 1);

    // ---- барабаны: A (основа) + B (с брейком и открытым хэтом) ----
    for (let st = 0; st < 16; st++) {
      if (st === 0 || st === 8) A(bb).pads.push({ at: st, p: 0 });
      if (st === 4 || st === 12) A(bb).pads.push({ at: st, p: 1 });
      if (st % 2 === 0) A(bb).pads.push({ at: st, p: 2 });
      if (st === 6 || st === 14) A(bb).pads.push({ at: st, p: 3 });
      if (st === 12) A(bb).pads.push({ at: st, p: 4 });

      if (st === 0 || st === 8 || st === 10) B(bb).pads.push({ at: st, p: 0 });
      if (st === 4 || st === 12) B(bb).pads.push({ at: st, p: 1 });
      if (st % 2 === 0) B(bb).pads.push({ at: st, p: 2 });
      if (st === 14 || st === 15) B(bb).pads.push({ at: st, p: 3 });
      if (st === 7 || st === 11) B(bb).pads.push({ at: st, p: 4 });
      if (st === 5 || st === 13) B(bb).pads.push({ at: st, p: 6 });
    }

    // ---- бас: A — грув, B — вариация ----
    const bassA = [33, null, null, 33, null, 36, null, 40, 33, null, null, 31, null, 33, null, null];
    const bassB = [33, null, 33, null, 36, null, 36, null, 40, null, 40, null, 31, null, 35, null];
    for (let st = 0; st < 16; st++) {
      if (bassA[st] != null) A(bass).notes.push({ at: st, m: bassA[st], len: 2, v: 0.9 });
      if (bassB[st] != null) B(bass).notes.push({ at: st, m: bassB[st], len: 1, v: 0.85 });
    }

    // ---- пэд: аккорды длиной в полтакта ----
    for (let st = 0; st < 16; st++) {
      if (st === 0) [57, 60, 64].forEach((m) => A(padTrack).notes.push({ at: st, m, len: 6, v: 0.6 }));
      if (st === 8) [55, 59, 62].forEach((m) => A(padTrack).notes.push({ at: st, m, len: 6, v: 0.6 }));
      if (st === 0) [57, 60, 64, 69].forEach((m) => B(padTrack).notes.push({ at: st, m, len: 12, v: 0.55 }));
    }

    // ---- клавиши: арпеджио восьмыми ----
    const arpA = [72, 76, 79, 84, 79, 76, 72, 76];
    const arpB = [77, 81, 84, 89, 84, 81, 77, 81];
    for (let st = 0; st < 16; st += 2) {
      const i = st / 2;
      A(keys).notes.push({ at: st, m: arpA[i % arpA.length], len: 1, v: 0.7 });
      B(keys).notes.push({ at: st, m: arpB[i % arpB.length], len: 1, v: 0.7 });
    }

    // ---- мелодия ----
    const melA = { 2: 69, 5: 72, 8: 71, 11: 68, 14: 64 };
    const melB = { 0: 69, 3: 72, 6: 76, 9: 74, 12: 72, 15: 71 };
    Object.keys(melA).forEach((k) => A(syn).notes.push({ at: Number(k), m: melA[k], len: 2, v: 0.8 }));
    Object.keys(melB).forEach((k) => B(syn).notes.push({ at: Number(k), m: melB[k], len: 2, v: 0.8 }));

    // ---- сцены: A A B A ---- 
    bb.scenes = 'AABA';
    bass.scenes = 'AABA';
    syn.scenes = 'AABB';
    padTrack.scenes = 'ABBA';
    keys.scenes = 'AABA';
    [bb, bass, syn, padTrack, keys].forEach((tr) => { tr.used = [0, 1]; });
    return s;
  }

  // ---------- общий рендер ----------
  function renderAll() {
    renderTracklist();
    renderMachine();
    renderSeq();
    renderMixer();
    applyMaster();
  }

  // ---------- инициализация ----------
  function bindGlobal() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab.dataset.view));
        if (tab.dataset.view === 'seq') renderSeq();
        if (tab.dataset.view === 'mix') renderMixer();
        if (tab.dataset.view === 'kaoss') {
          ensureAudio();
          renderKaoss();
        }
      });
    });

    document.getElementById('btnPlay').addEventListener('click', () => {
      ensureAudio();
      startTransport();
    });

    document.getElementById('btnRec').addEventListener('click', (e) => {
      state.recording = !state.recording;
      e.currentTarget.classList.toggle('on', state.recording);
      UI.toast(state.recording ? 'Запись включена: ноты/удары пишутся в паттерн' : 'Запись выключена');
    });

    document.getElementById('btnStopAll').addEventListener('click', () => {
      panicVoices();
      if (state.kaossInst) state.kaossInst.stopAll();
      if (state.kaossFX) state.kaossFX.reset();
      UI.toast('Всё заглушено');
    });

    document.getElementById('bpm').addEventListener('change', (e) => {
      song.bpm = UI.clamp(Number(e.target.value) || 120, 40, 220);
      e.target.value = song.bpm;
      updateStepDur();
      if (state.kaossInst) state.kaossInst.bpm = song.bpm;
    });

    document.getElementById('stepCount').addEventListener('change', (e) => {
      song.steps = Number(e.target.value);
      resizePatterns(song);
      renderSeq();
      if (state.playing) state.currentStep = 0;
    });

    document.getElementById('loopBars').addEventListener('change', (e) => {
      song.arrangeBars = Number(e.target.value);
      resizePatterns(song);
      renderSeq();
      if (state.playing) state.currentStep = 0;
    });

    document.getElementById('btnClearPattern').addEventListener('click', () => {
      const t = song.tracks[state.activeTrack];
      Pattern.clear(t);
      renderSeq();
      UI.toast('Паттерн ' + 'ABCD'[t.patIndex] + ' очищен: ' + t.name);
    });

    document.getElementById('btnRandom').addEventListener('click', () => {
      randomBeat();
    });

    document.getElementById('btnMidi').addEventListener('click', initMidi);
    document.getElementById('btnMidi2').addEventListener('click', initMidi);
    const outSel = document.getElementById('midiOut');
    if (outSel) {
      outSel.addEventListener('change', (e) => {
        state.midiOutId = e.target.value;
        if (state.midiAccess) {
          Array.from(state.midiAccess.outputs.values()).forEach((o) => { o.clear && o.clear(); });
        }
        if (state.midiOutId) UI.toast('MIDI-выход: партии идут в выбранный порт (Nexus принимает с него, если открыт в DAW)', 'ok');
      });
    }
    const chSel = document.getElementById('midiOutCh');
    if (chSel) {
      chSel.addEventListener('change', (e) => { state.midiOutChannel = Number(e.target.value); });
    }

    document.getElementById('btnExportWav').addEventListener('click', exportWav);
    const mp3Btn = document.getElementById('btnExportMp3');
    if (mp3Btn) mp3Btn.addEventListener('click', exportMp3);
    document.getElementById('btnExportMidi').addEventListener('click', exportMidi);
    // установка PWA: перехватываем предложение браузера
    let installPrompt = null;
    const installBtn = document.getElementById('btnInstall');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPrompt = e;
      if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Добавить на главный экран'; }
    });
    if (installBtn) {
      installBtn.addEventListener('click', () => {
        if (!installPrompt) {
          UI.toast('Откройте меню браузера → «Установить приложение» / «На главный экран»');
          return;
        }
        installPrompt.prompt();
        installPrompt.userChoice.then((res) => {
          UI.toast(res.outcome === 'accepted' ? 'Студия установлена на устройство' : 'Установка отменена');
          installPrompt = null;
          installBtn.disabled = true;
        });
      });
    }
    window.addEventListener('appinstalled', () => UI.toast('Mini Studio установлена', 'ok'));

    const padModeBtn = document.getElementById('btnPadMode');
    if (padModeBtn) padModeBtn.addEventListener('click', () => {
      const on = document.body.classList.toggle('pad-focus');
      padModeBtn.classList.toggle('on', on);
      document.querySelector('.tab[data-view="kaoss"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (window.TouchUI) TouchUI.haptic(12);
      if (on && window.TouchUI) TouchUI.toggleFullscreen();
      UI.toast(on ? 'Пэд-режим: крупные пэды (Esc — выйти)' : 'Обычный режим');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('pad-focus')) {
        document.body.classList.remove('pad-focus');
        const b = document.getElementById('btnPadMode');
        if (b) b.classList.remove('on');
      }
    });

    const quickSave = document.getElementById('btnQuickSave');
    if (quickSave) quickSave.addEventListener('click', () => {
      saveToSlot('', { quiet: true });
      UI.toast('Быстрое сохранение добавлено в список (вкладка «Экспорт»)', 'ok');
    });
    const saveSlotBtn = document.getElementById('btnSaveSlot');
    if (saveSlotBtn) saveSlotBtn.addEventListener('click', () => {
      const inp = document.getElementById('projName');
      saveToSlot(inp ? inp.value : '');
      if (inp) inp.value = '';
    });
    const zipBtn = document.getElementById('btnSaveZip');
    if (zipBtn) zipBtn.addEventListener('click', saveProjectZip);
    const zipOpenBtn = document.getElementById('btnOpenZip');
    const zipInput = document.getElementById('fileZip');
    if (zipOpenBtn && zipInput) {
      zipOpenBtn.addEventListener('click', () => zipInput.click());
      zipInput.addEventListener('change', (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) openProjectZip(f);
      });
    }
    const saveFileBtn = document.getElementById('btnSaveFile');
    if (saveFileBtn) saveFileBtn.addEventListener('click', saveProject);
    const autoRestore = document.getElementById('btnAutoRestore');
    if (autoRestore) autoRestore.addEventListener('click', () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) { UI.toast('Автосохранения ещё нет', 'error'); return; }
        loadProject(JSON.parse(raw));
        UI.toast('Автосохранение восстановлено', 'ok');
      } catch (e) { UI.toast('Не удалось прочитать автосохранение: ' + e.message, 'error'); }
    });
    const clearAll = document.getElementById('btnClearAll');
    if (clearAll) clearAll.addEventListener('click', () => {
      const ok = window.confirm('Стереть все сохранения в браузере (слоты и автосохранение)? Файлы .json останутся.');
      if (!ok) return;
      try { localStorage.removeItem(SLOTS_KEY); localStorage.removeItem(LS_KEY); } catch (e) {}
      renderProjectList();
      autoSaveState('автосохранение очищено', false);
      UI.toast('Все сохранения в браузере стёрты');
    });
    renderProjectList();
    document.getElementById('btnImportJson').addEventListener('click', () => document.getElementById('fileJson').click());
    document.getElementById('fileJson').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          loadProject(obj && obj.data && obj.data.tracks ? obj.data : obj);
          const ni = document.getElementById('projName');
          if (ni && f.name) ni.value = f.name.replace(/\.json$/i, '');
          UI.toast('Проект загружен: ' + f.name, 'ok');
        }
        catch (err) { UI.toast('Ошибка загрузки: ' + err.message, 'error'); }
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    document.getElementById('btnDemo').addEventListener('click', () => {
      stopTransport();
      song = demoSong();
      refreshChannelsRebuild();
      state.activeTrack = 0;
      document.getElementById('bpm').value = song.bpm;
      renderAll();
      UI.toast('Демо-трек загружен — жмите «Играть»', 'ok');
    });

    document.getElementById('btnReset').addEventListener('click', () => {
      stopTransport();
      song = emptySong();
      refreshChannelsRebuild();
      state.activeTrack = 0;
      renderAll();
      UI.toast('Новый пустой проект');
    });

    document.getElementById('btnHelp').addEventListener('click', showHelp);

    // клавиатура
    const held = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'ы')) {
        e.preventDefault();
        saveToSlot('', { quiet: true });
        UI.toast('Проект сохранён в браузер (Ctrl+S)', 'ok');
        return;
      }
      if (k === ' ') { e.preventDefault(); ensureAudio(); startTransport(); return; }
      if (held.has(k)) return;
      const t = song.tracks[state.activeTrack];
      if (t && t.engine === 'beatbox' && PAD_KEYS.indexOf(k) >= 0) {
        e.preventDefault();
        held.add(k);
        const pad = PAD_KEYS.indexOf(k);
        liveDrum(pad);
        const p = document.querySelector('.pad[data-pad="' + pad + '"]');
        if (p) { p.classList.add('on'); setTimeout(() => p.classList.remove('on'), 120); }
        if (state.recording && state.playing) {
          recordPad(t, pad);
        }
        return;
      }
      if (KEYMAP[k] != null) {
        e.preventDefault();
        held.add(k);
        const midi = KEYMAP[k] - 12; // октава сдвинута вниз для удобства
        liveNoteOn(midi);
        markKey(midi, true);
        if (state.recording && state.playing) {
          recordNote(t, midi);
        }
      }
    });
    // [ и ] переключают машину: у каждой свой секвенсор
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
      if (e.key !== '[' && e.key !== ']') return;
      const dir = e.key === ']' ? 1 : -1;
      state.activeTrack = (state.activeTrack + dir + song.tracks.length) % song.tracks.length;
      renderAll();
      UI.toast('Машина: ' + song.tracks[state.activeTrack].name);
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      held.delete(k);
      if (KEYMAP[k] != null) {
        const midi = KEYMAP[k] - 12;
        liveNoteOff(midi);
        markKey(midi, false);
      }
    });

    // автосохранение: каждые 20 с, только если проект изменился
    let lastAuto = '';
    setInterval(() => {
      if (state.playing) return;
      let json = '';
      try { json = JSON.stringify(serialize()); } catch (e) { return; }
      if (json === lastAuto) return;
      try {
        localStorage.setItem(LS_KEY, json);
        lastAuto = json;
        autoSaveState('автосохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), true);
      } catch (e) {
        autoSaveState('автосохранение не удалось (нет места)', false);
      }
    }, 20000);
  }

  function randomBeat() {
    const t = song.tracks[state.activeTrack];
    const n = totalSteps();
    const pat = Pattern.pattern(t);
    if (t.engine === 'beatbox') {
      pat.pads = [];
      for (let s = 0; s < n; s++) {
        const inBar = s % song.steps;
        if (inBar === 0 || inBar === 8) pat.pads.push({ at: s, p: 0 });
        if (inBar === 4 || inBar === 12) pat.pads.push({ at: s, p: 1 });
        if (inBar % 4 === 2) pat.pads.push({ at: s, p: 2 });
        if (Math.random() < 0.14) pat.pads.push({ at: s, p: 3 });
        if (Math.random() < 0.07) pat.pads.push({ at: s, p: Math.random() < 0.5 ? 5 : 6 });
        if (Math.random() < 0.05) pat.pads.push({ at: s, p: 7 });
      }
    } else {
      const scale = [0, 2, 3, 5, 7, 8, 10];
      const root = 48;
      pat.notes = [];
      for (let s = 0; s < n; s++) {
        if (Math.random() < 0.32) {
          const deg = scale[Math.floor(Math.random() * scale.length)];
          const oct = Math.random() < 0.25 ? 12 : 0;
          pat.notes.push({ at: s, m: root + deg + oct, len: Math.random() < 0.3 ? 2 : 1, v: 0.85 });
        }
      }
    }
    Pattern.markUsed(t);
    renderSeq();
    UI.toast('Случайный паттерн ' + 'ABCD'[t.patIndex] + ' для «' + t.name + '»');
  }

  function showHelp() {
    const body = el('div', {}, [
      el('p', {}, ['Транспорт: ', el('b', { text: 'Space' }), ' — играть/стоп. BPM и число шагов меняются на лету, «Аранжировка» задаёт длину сцены в тактах.']),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Паттерны (A–D) на каждую машину' }),
      el('p', { class: 'muted', text: 'У каждой машины свой банк из четырёх паттернов. В стойке над пиано-роллом есть слоты A/B/C/D и кнопка «Копия» (A→B и т. п.). Внизу вкладки «Редактор паттернов» — блоки банка и строка «Сцены»: буквы в клетках показывают, какой паттерн играет в каком такте аранжировки.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Свой секвенсор у каждой машины' }),
      el('p', { class: 'muted', text: 'У каждого синтезатора — собственный пиано-ролл со своим банком A/B/C/D, а у драм-машины свой секвенсор по подушкам (прямо в её корпусе, вкладка «Стойка»). Ролл есть и в корпусе машины, и на вкладке «Секвенсор».' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Пиано-ролл' }),
      el('p', { class: 'muted', text: 'Клик по пустому месту — новая нота. Тяните ноту, чтобы двигать её по времени и высоте; за правый край — длина в шагах; жёлтая точка слева внизу — громкость (velocity). Правый клик по ноте — удалить. Светлая линия — играющий шаг (бегунок).' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Настройки своего секвенсора' }),
      el('p', { class: 'muted', text: 'Над роллом: «Клавиши» меняет высоту дорожек (удобнее попадать пальцем), «Следовать» прокручивает ролл к играющему такту, «×2» дублирует ноты во второй такт, «Сдвиг ±1» двигает их по шагам, «±12» транспонирует на октаву. Настройки индивидуальные и сохраняются вместе с проектом. В стойке ролл можно свернуть кнопкой «Свернуть».' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Редактор паттернов' }),
      el('p', { class: 'muted', text: 'Квадратная сетка — это шаговый редактор паттерна: клик включает/выключает ноту или удар в шаге, правый клик удаляет. Блоки разных машин отделены линией и своим цветом, у мелодических машин дорожки выше — по ним проще попадать пальцем. У драм-машины сетка разложена по 8 каналам.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Клавиатура и телефон' }),
      el('p', { class: 'muted', text: 'Space — играть/стоп, [ и ] — переключить машину (её секвенсор появляется на вкладке «Секвенсор»), A S D F G H J K — подушки драм-машины. На телефоне сетку и ролл можно тянуть пальцем, ноты и шаги увеличены под палец.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'MIDI и запись' }),
      el('p', { class: 'muted', text: 'Кнопка MIDI включает Web MIDI: ноты играют на выбранной машине, CC1 крутит срез фильтра, при включённой записи (●) ноты/удары пишутся в активный паттерн в реальном времени.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Kaoss-модули' }),
      el('p', { class: 'muted', text: 'Вкладка «Kaoss»: X-Y пэд-синтезатор с двумя лупами и X-Y процессор эффектов. HOLD фиксирует позицию после отпускания пальца. Свои WAV/MP3 грузятся в оба модуля: у синтезатора сэмпл режется на слайсы (ровно или по пикам), у процессора есть плеер с pitch adjust. Фразу из лупа можно перенести в паттерн кнопкой «→ Паттерн».' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Nexus и сторонние библиотеки' }),
      el('p', { class: 'muted', text: 'Загрузить библиотеку Nexus (.nks/.ncw/.xp) в браузерную студию нельзя: это закрытый формат reFX, а браузер не умеет запускать VST-плагины. Рабочий путь — «Экспорт MIDI»: MIDI-файл открывается в DAW, где на дорожки ставится Nexus, и партии играют его звуками. Один трек в файле = одна машина.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Ограничения прототипа' }),
      el('p', { class: 'muted', text: 'VST-плагины браузер не поддерживает — это принципиальное ограничение веб-платформы. Вместо них встроенные машины, сэмплер PCMSynth и свои WAV-сэмплы. Экспорт — офлайн-рендер в WAV (то, что включено в аранжировке).' }),
    ]);
    UI.modal('Как пользоваться', body, [{ label: 'Понятно', primary: true }]);
  }

  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    song = emptySong();
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) loadProject(JSON.parse(saved));
    } catch (e) { /* используем пустой проект */ }
    if (window.TouchUI) TouchUI.init();
    // офлайн-кэш: работает и в APK, и в браузере (по http/https)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн не критичен */ });
      });
    }

    bindGlobal();
    renderAll();
    // хэш-роутинг вкладок: #kaoss, #io — чтобы работали ярлыки PWA
    const hashView = (location.hash || '').replace('#', '');
    const hashTab = hashView && document.querySelector('.tab[data-view="' + hashView + '"]');
    if (hashTab) hashTab.click();
    requestAnimationFrame(meterLoop);
    // первый жест включает звук
    const wake = () => { ensureAudio(); document.removeEventListener('pointerdown', wake); };
    document.addEventListener('pointerdown', wake);
  }

  // чтобы всё было в едином состоянии
  window.MS = {
    ensureAudio,
    get song() { return song; },
    state,
    renderAll,
    demo: () => { song = demoSong(); refreshChannelsRebuild(); renderAll(); },
    buildEvents: (a, b) => buildEvents(a, b),
    kaoss: () => ({ inst: state.kaossInst, fx: state.kaossFX }),
    renderKaoss,
    exportWav,
    exportMp3,
    renderProject,
    saveToSlot,
    readSlots,
    saveProjectZip,
    openProjectZip,
    collectSamples,
    kaossSnapshot,
    renderProjectList,
    serialize,
    loadProject,
    patternSteps: () => patternSteps(),
    arrangeSteps: () => arrangeSteps(),
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
