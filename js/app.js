/* Mini Studio — приложение: состояние проекта, стойка, секвенсор, пиано-ролл,
   микшер, MIDI-вход и экспорт. */
(function () {
  'use strict';

  const AE = window.AudioEngine;
  const ENG = window.ENGINES;
  const el = UI.el;

  const LS_KEY = 'mini-studio-project-v1';

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
      presets: undefined,
      pat: [],       // для BeatBox: массив [padIndex...]
      notes: [],     // для мелодических: массив [midi...]
      samples: {},   // padIndex (beatbox) или 'main' (pcmsynth) -> {channels, sampleRate}
    };
    return t;
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
      bars: 2,
      feedback: 0.35,
      tracks,
      masterVol: 0.85,
      eq: { low: 0, mid: 0, high: 0 },
    };
    resizePatterns(s);
    return s;
  }

  function totalSteps() { return song.steps * song.bars; }

  function resizePatterns(s) {
    const n = s.steps * s.bars;
    s.tracks.forEach((t) => {
      const pat = t.pat.slice(0, n);
      const notes = t.notes.slice(0, n);
      while (pat.length < n) pat.push([]);
      while (notes.length < n) notes.push([]);
      t.pat = pat;
      t.notes = notes;
    });
  }

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
    panicVoices();
    clearPlayhead();
    document.getElementById('pos').textContent = '001 : 01';
  }

  function scheduler() {
    if (!state.playing) return;
    const ahead = 0.12;
    while (state.nextTime < state.ctx.currentTime + ahead) {
      playStep(state.currentStep, state.nextTime);
      state.nextTime += currentStepDuration();
      state.currentStep = (state.currentStep + 1) % totalSteps();
    }
    paintPlayhead();
  }

  function playStep(step, time) {
    song.tracks.forEach((t, i) => {
      if (t.mute) return;
      const ch = state.channels[i];
      if (!ch) return;
      if (t.engine === 'beatbox') {
        (t.pat[step] || []).forEach((pad) => {
          AE.playDrum(state.ctx, ch.input, t.params, pad, time, 0.95, t.samples[pad] || null);
        });
      } else {
        const dur = currentStepDuration() * 0.85;
        const smp = ENG[t.engine].sampler ? (t.samples.main || null) : null;
        (t.notes[step] || []).forEach((midi) => {
          AE.playNote(state.ctx, ch.input, t.engine, t.params, midi, 0.85, time, dur, smp);
        });
      }
    });
  }

  function panicVoices() {
    Object.keys(state.liveVoices).forEach((k) => {
      (state.liveVoices[k] || []).forEach((v) => v.kill());
    });
    state.liveVoices = {};
    document.querySelectorAll('.key.on').forEach((k) => k.classList.remove('on'));
    document.querySelectorAll('.pad.on').forEach((p) => p.classList.remove('on'));
  }

  function liveNoteOn(midi) {
    const t = song.tracks[state.activeTrack];
    if (!t || t.mute) return;
    ensureAudio();
    const ch = state.channels[state.activeTrack];
    const list = state.liveVoices[state.activeTrack] || (state.liveVoices[state.activeTrack] = []);
    if (!ENG[t.engine].poly) list.forEach((v) => v.kill());
    const smp = ENG[t.engine].sampler ? (t.samples.main || null) : null;
    const v = new AE.Voice(state.ctx, ch.input, t.engine, t.params, midi, 0.9, state.ctx.currentTime, smp);
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
  }

  function paintPlayhead() {
    if (state.currentStep === state.lastPlayed) return;
    state.lastPlayed = state.currentStep;
    document.querySelectorAll('.cell.playing, .head-cell.playhead').forEach((c) => {
      c.classList.remove('playing', 'playhead');
    });
    const step = state.currentStep;
    document.querySelectorAll('[data-step="' + step + '"]').forEach((c) => c.classList.add('playing'));
    document.querySelectorAll('.head-cell[data-step="' + step + '"]').forEach((c) => c.classList.add('playhead'));
    const bar = Math.floor(step / song.steps) + 1;
    const beat = Math.floor((step % song.steps) / 4) + 1;
    document.getElementById('pos').textContent =
      String(bar).padStart(3, '0') + ' : ' + String(beat).padStart(2, '0');
  }

  function clearPlayhead() {
    document.querySelectorAll('.cell.playing, .head-cell.playhead').forEach((c) => c.classList.remove('playing', 'playhead'));
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

    if (t.engine === 'beatbox') {
      machine.appendChild(el('div', { class: 'machine-head', style: { borderTop: '1px solid var(--line)', borderBottom: 'none', paddingTop: '10px', paddingBottom: '10px' } }, [
        el('span', { class: 'hint', text: 'Клавиши A S D F G H J K играют по подушкам. Свои WAV: PCMSynth/BeatBox — через «Свои сэмплы».' }),
      ]));
    }
    wrap.appendChild(machine);
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
            const st = state.currentStep;
            const arr = t.pat[st] || (t.pat[st] = []);
            if (arr.indexOf(i) < 0) arr.push(i);
            renderSeq();
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
    return el('div', {}, [grid, el('div', { class: 'hint', style: { marginTop: '8px' }, text: 'Подушки пронумерованы 1–8. Свои сэмплы подставляются в те же каналы.' })]);
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
      if (state.recording && state.playing) {
        const t = song.tracks[state.activeTrack];
        const st = state.currentStep;
        const arr = t.notes[st] || (t.notes[st] = []);
        if (arr.indexOf(midi) < 0) arr.push(midi);
        renderSeq();
      }
    });
    const up = () => { liveNoteOff(midi); node.classList.remove('on'); };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointerleave', up);
    node.addEventListener('pointercancel', up);
  }

  // ---------- отрисовка: секвенсор ----------
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

  function cellHas(row, step) {
    const t = song.tracks[row.ti];
    if (row.beatbox) return (t.pat[step] || []).indexOf(row.pad) >= 0;
    return (t.notes[step] || []).length > 0;
  }

  function toggleCell(row, step, note) {
    const t = song.tracks[row.ti];
    if (row.beatbox) {
      const arr = t.pat[step] || (t.pat[step] = []);
      const i = arr.indexOf(row.pad);
      if (i >= 0) arr.splice(i, 1); else arr.push(row.pad);
    } else {
      const arr = t.notes[step] || (t.notes[step] = []);
      if (arr.length) {
        arr.length = 0;
      } else {
        const midi = note != null ? note : (state.lastNote[row.ti] || 60);
        arr.push(midi);
        state.lastNote[row.ti] = midi;
      }
    }
    const cell = document.querySelector(
      '.cell[data-track="' + row.ti + '"][data-pad="' + (row.pad == null ? '' : row.pad) + '"][data-step="' + step + '"]'
    );
    if (cell) {
      const on = cellHas(row, step);
      cell.classList.toggle('on', on);
      cell.classList.toggle('strong', on && step % 4 === 0);
    }
    renderRoll();
  }

  function renderSeq() {
    const grid = document.getElementById('seqGrid');
    const steps = totalSteps();
    grid.innerHTML = '';
    state.lastPlayed = -1;
    grid.style.gridTemplateColumns = '108px repeat(' + steps + ', minmax(22px, 1fr))';

    // шапка
    grid.appendChild(el('div', { class: 'cell head-cell', style: { background: '#0f141c', cursor: 'default' } }));
    for (let s = 0; s < steps; s++) {
      const cls = ['cell', 'head-cell'];
      if (s % 4 === 0) cls.push('beat');
      if (s % song.steps === 0 && s > 0) cls.push('bar');
      const c = el('div', { class: cls.join(' '), 'data-step': s }, s % 4 === 0 ? [el('span', { style: { position: 'absolute', left: '3px', top: '3px', fontSize: '9px', color: '#5c6a80' }, text: String(Math.floor(s / 4) + 1) })] : []);
      grid.appendChild(c);
    }

    gridRows().forEach((row) => {
      const label = el('div', { class: 'grid-label' }, [
        el('span', { class: 'nm', text: row.label, title: row.sub }),
        row.beatbox ? null : el('button', {
          class: 'btn ghost mute-mini', text: 'M',
          onclick: (e) => { e.stopPropagation(); const t = song.tracks[row.ti]; t.mute = !t.mute; refreshChannels(); renderAll(); },
        }),
      ]);
      label.addEventListener('click', () => { state.activeTrack = row.ti; renderAll(); });
      grid.appendChild(label);

      for (let s = 0; s < steps; s++) {
        const on = cellHas(row, s);
        const cls = ['cell'];
        if (s % 4 === 0) cls.push('beat');
        if (s % song.steps === 0 && s > 0) cls.push('bar');
        if (on) cls.push('on');
        if (on && s % 4 === 0) cls.push('strong');
        const c = el('div', { class: cls.join(' '), 'data-step': s, 'data-track': row.ti, 'data-pad': row.pad == null ? '' : row.pad });
        c.addEventListener('click', (e) => {
          e.preventDefault();
          const switchedTrack = state.activeTrack !== row.ti;
          state.activeTrack = row.ti;
          if (switchedTrack) { renderTracklist(); renderMachine(); }
          toggleCell(row, s);
          if (row.beatbox && cellHas(row, s)) liveDrum(row.pad);
          else if (!row.beatbox && cellHas(row, s)) {
            const midi = (song.tracks[row.ti].notes[s] || [])[0];
            if (midi != null) liveNoteOn(midi);
          }
        });
        c.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const t = song.tracks[row.ti];
          if (row.beatbox) {
            const arr = t.pat[s] || [];
            const i = arr.indexOf(row.pad);
            if (i >= 0) arr.splice(i, 1);
          } else {
            t.notes[s] = [];
          }
          renderSeq(); renderRoll();
        });
        grid.appendChild(c);
      }
    });
    renderRoll();
  }

  function renderRoll() {
    const panel = document.getElementById('rollPanel');
    const t = song.tracks[state.activeTrack];
    panel.innerHTML = '';
    if (!t) return;
    if (t.engine === 'beatbox') {
      panel.appendChild(el('div', { class: 'hint', text: 'Для драм-машины используется ступенчатая сетка выше: 8 дорожек по подушкам. Пиано-ролл доступен для мелодических машин.' }));
      return;
    }
    const steps = totalSteps();
    const cellW = 22;
    const low = 36, high = 84;
    const head = el('div', { class: 'seq-head', style: { paddingTop: '0' } }, [
      el('h3', { style: { margin: '0', fontSize: '13px' }, text: 'Пиано-ролл — ' + t.name }),
      el('span', { class: 'hint', text: 'Клик по клетке включает ноту, повторный клик убирает. Слева — клавиши.' }),
    ]);
    panel.appendChild(head);

    const roll = el('div', { class: 'roll' });
    const inner = el('div', { class: 'roll-inner' });
    for (let midi = high; midi >= low; midi--) {
      const isBlack = [1, 3, 6, 8, 10].indexOf(midi % 12) >= 0;
      const row = el('div', { class: 'roll-row' });
      const name = noteName(midi);
      row.appendChild(el('div', { class: 'roll-key' + (isBlack ? ' blackkey' : ''), text: name }));
      const line = el('div', { class: 'cellroll', style: { width: steps * cellW + 'px' } });
      for (let s = 0; s < steps; s++) {
        const on = (t.notes[s] || []).indexOf(midi) >= 0;
        const w = (s % 4 === 0 ? '' : '');
        const cell = el('div', {
          class: 'cell roll-cell',
          'data-step': s,
          style: {
            position: 'absolute', left: s * cellW + 'px', width: cellW + 'px', top: '0', bottom: '0',
            borderRight: (s % 4 === 3 ? '1px solid #2b3646' : '1px solid #131a24'),
            cursor: 'pointer',
          },
          onclick: () => {
            const arr = t.notes[s] || (t.notes[s] = []);
            const i = arr.indexOf(midi);
            if (i >= 0) arr.splice(i, 1); else arr.push(midi);
            state.lastNote[state.activeTrack] = midi;
            renderSeq();
          },
        });
        if (on) {
          cell.appendChild(el('div', {
            style: { position: 'absolute', top: '2px', bottom: '2px', left: '1px', right: '1px', borderRadius: '3px', background: ENG[t.engine].accent },
          }));
        }
        line.appendChild(cell);
      }
      row.appendChild(line);
      inner.appendChild(row);
    }
    roll.appendChild(inner);
    panel.appendChild(roll);
  }

  function noteName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  // ---------- микшер ----------
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
  }

  function removeTrack() {
    if (song.tracks.length <= 1) { UI.toast('Нельзя удалить последнюю машину', 'error'); return; }
    song.tracks.splice(state.activeTrack, 1);
    state.activeTrack = Math.max(0, state.activeTrack - 1);
    refreshChannelsRebuild();
    renderAll();
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
    access.onstatechange = setMidiStatus;
    Array.from(access.inputs.values()).forEach((input) => {
      input.onmidimessage = onMidiMessage;
    });
    UI.toast('MIDI подключён', 'ok');
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
    if (cmd === 0x90 && d2 > 0) {
      liveNoteOn(d1);
      markKey(d1, true);
      midiLog('NoteOn  ch' + ch + ' ' + noteName(d1) + ' vel ' + d2);
      if (state.recording && state.playing) {
        const t = song.tracks[state.activeTrack];
        const st = state.currentStep;
        const arr = t.notes[st] || (t.notes[st] = []);
        if (arr.indexOf(d1) < 0) arr.push(d1);
        renderSeq();
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      liveNoteOff(d1);
      markKey(d1, false);
      midiLog('NoteOff ch' + ch + ' ' + noteName(d1));
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

  function markKey(midi, on) {
    document.querySelectorAll('.key[data-midi="' + midi + '"]').forEach((k) => {
      k.classList.toggle('on', on);
    });
  }

  // ---------- экспорт / импорт ----------
  function buildEvents(barsFrom, barsTo) {
    const events = [];
    const stepDur = 60 / song.bpm / 4;
    let t = 0;
    for (let bar = barsFrom; bar < barsTo; bar++) {
      for (let s = 0; s < song.steps; s++) {
        const step = bar * song.steps + s;
        song.tracks.forEach((tr, ci) => {
          if (tr.mute) return;
          if (tr.engine === 'beatbox') {
            (tr.pat[step] || []).forEach((pad) => {
              events.push({
                engine: 'beatbox', params: tr.params, pad, channel: ci,
                velocity: 0.95, time: t, duration: stepDur,
                sample: tr.samples[pad] || null,
              });
            });
          } else {
            const smp = ENG[tr.engine].sampler ? (tr.samples.main || null) : null;
            (tr.notes[step] || []).forEach((midi) => {
              events.push({
                engine: tr.engine, params: tr.params, midi, channel: ci,
                velocity: 0.85, time: t, duration: stepDur * 0.85, sample: smp,
              });
            });
          }
        });
        t += stepDur;
      }
    }
    return events;
  }

  function exportWav() {
    const status = document.getElementById('renderStatus');
    status.innerHTML = '';
    status.appendChild(el('i', { style: { width: '10%' } }));
    const total = (60 / song.bpm / 4) * song.steps * song.bars;
    const events = buildEvents(0, song.bars);
    if (!events.length) { UI.toast('Секвенсор пуст — нечего рендерить', 'error'); return; }

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

    UI.toast('Рендерю WAV…');
    AE.renderToBuffer(renderSong, total, 44100).then((buffer) => {
      const blob = AE.encodeWav(buffer);
      UI.download(blob, 'mini-studio-' + Date.now() + '.wav');
      status.innerHTML = '';
      status.appendChild(el('i', { style: { width: '100%' } }));
      UI.toast('WAV готов: ' + song.bars + ' такт(ов), ' + (blob.size / 1048576).toFixed(1) + ' МБ', 'ok');
    }).catch((err) => {
      console.error(err);
      UI.toast('Ошибка рендера: ' + err.message, 'error');
    });
  }

  function saveProject() {
    const clean = JSON.parse(JSON.stringify({
      bpm: song.bpm, steps: song.steps, bars: song.bars, feedback: song.feedback,
      masterVol: song.masterVol, eq: song.eq,
      tracks: song.tracks.map((t) => ({
        id: t.id, engine: t.engine, name: t.name, vol: t.vol, pan: t.pan,
        delay: t.delay, reverb: t.reverb, mute: t.mute, params: t.params,
        pat: t.pat, notes: t.notes,
      })),
    }));
    try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); } catch (e) {}
    UI.download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }), 'mini-studio-project.json');
    UI.toast('Проект сохранён (в файл и в браузер)', 'ok');
  }

  function loadProject(obj) {
    if (!obj || !Array.isArray(obj.tracks)) throw new Error('Неверный формат проекта');
    song = {
      bpm: obj.bpm || 120, steps: obj.steps || 16, bars: obj.bars || 2,
      feedback: obj.feedback != null ? obj.feedback : 0.35,
      masterVol: obj.masterVol != null ? obj.masterVol : 0.85,
      eq: obj.eq || { low: 0, mid: 0, high: 0 },
      tracks: obj.tracks.map((t) => {
        const nt = newTrack(t.engine || 'subsynth', t.name || 'Машина', t.params);
        nt.id = t.id || uid();
        nt.vol = t.vol != null ? t.vol : 0.8;
        nt.pan = t.pan || 0;
        nt.delay = t.delay || 0;
        nt.reverb = t.reverb != null ? t.reverb : 0.1;
        nt.mute = !!t.mute;
        nt.params = Object.assign(window.defaultParams(nt.engine), t.params || {});
        nt.pat = (t.pat || []).map((a) => (a || []).slice());
        nt.notes = (t.notes || []).map((a) => (a || []).slice());
        return nt;
      }),
    };
    resizePatterns(song);
    state.activeTrack = Math.min(state.activeTrack, song.tracks.length - 1);
    document.getElementById('bpm').value = song.bpm;
    document.getElementById('stepCount').value = String(song.steps);
    document.getElementById('loopBars').value = String(song.bars);
    refreshChannelsRebuild();
    applyMaster();
    renderAll();
  }

  // ---------- демо ----------
  function demoSong() {
    const s = emptySong();
    s.bpm = 124;
    s.steps = 16;
    s.bars = 2;

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

    const n = s.steps * s.bars;
    for (let step = 0; step < n; step++) {
      const inBar = step % 16;
      // драм-паттерн
      if (inBar === 0 || inBar === 8) bb.pat[step].push(0);
      if (inBar === 4 || inBar === 12) bb.pat[step].push(1);
      if (inBar % 2 === 0) bb.pat[step].push(2);
      if (inBar === 6 || inBar === 14) bb.pat[step].push(3);
      if (inBar === 12) bb.pat[step].push(4);

      // басовая линия (A1 = 33)
      const bassPat = [33, null, null, 33, null, 36, null, 40, 33, null, null, 31, null, 33, null, null];
      const bn = bassPat[inBar];
      if (bn != null) bass.notes[step].push(bn);

      // аккорды
      if (inBar === 0 || inBar === 10) {
        [57, 60, 64].forEach((m) => padTrack.notes[step].push(m));
      }
      if (inBar === 6) {
        [57, 62, 65].forEach((m) => padTrack.notes[step].push(m));
      }

      // арпеджио на клавишах
      const arp = [72, 76, 79, 84, 79, 76, 72, 76];
      if (inBar % 2 === 0) {
        keys.notes[step].push(arp[(inBar / 2) % arp.length]);
      }
      // мелодия на синте
      const mel = { 2: 69, 5: 72, 8: 71, 11: 68, 14: 64 };
      if (mel[inBar] != null) syn.notes[step].push(mel[inBar]);
    }
    return s;
  }

  // ---------- общий рендер ----------
  function renderAll() {
    renderTracklist();
    renderMachine();
    renderSeq();
    renderMixer();
    applyMaster();
    document.querySelectorAll('.knob-arc').forEach(() => {});
  }

  // ---------- инициализация ----------
  function bindGlobal() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab.dataset.view));
        if (tab.dataset.view === 'seq') renderSeq();
        if (tab.dataset.view === 'mix') renderMixer();
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
      UI.toast('Всё заглушено');
    });

    document.getElementById('bpm').addEventListener('change', (e) => {
      song.bpm = UI.clamp(Number(e.target.value) || 120, 40, 220);
      e.target.value = song.bpm;
      updateStepDur();
    });

    document.getElementById('stepCount').addEventListener('change', (e) => {
      song.steps = Number(e.target.value);
      resizePatterns(song);
      renderSeq();
    });

    document.getElementById('loopBars').addEventListener('change', (e) => {
      song.bars = Number(e.target.value);
      resizePatterns(song);
      renderSeq();
      if (state.playing) state.currentStep = 0;
    });

    document.getElementById('btnClearPattern').addEventListener('click', () => {
      const t = song.tracks[state.activeTrack];
      t.pat = t.pat.map(() => []);
      t.notes = t.notes.map(() => []);
      renderSeq();
      UI.toast('Паттерн очищен: ' + t.name);
    });

    document.getElementById('btnRandom').addEventListener('click', () => {
      randomBeat();
    });

    document.getElementById('btnMidi').addEventListener('click', initMidi);
    document.getElementById('btnMidi2').addEventListener('click', initMidi);

    document.getElementById('btnExportWav').addEventListener('click', exportWav);
    document.getElementById('btnExportJson').addEventListener('click', saveProject);
    document.getElementById('btnImportJson').addEventListener('click', () => document.getElementById('fileJson').click());
    document.getElementById('fileJson').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { loadProject(JSON.parse(reader.result)); UI.toast('Проект загружен', 'ok'); }
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
      if (e.target.matches('input, select, textarea')) return;
      const k = e.key.toLowerCase();
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
          const st = state.currentStep;
          const arr = t.pat[st] || (t.pat[st] = []);
          if (arr.indexOf(pad) < 0) arr.push(pad);
          renderSeq();
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
          const st = state.currentStep;
          const arr = t.notes[st] || (t.notes[st] = []);
          if (arr.indexOf(midi) < 0) arr.push(midi);
          renderSeq();
        }
      }
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

    // периодическая автосохранение
    setInterval(() => {
      try {
        const clean = { bpm: song.bpm, steps: song.steps, bars: song.bars, eq: song.eq, masterVol: song.masterVol,
          tracks: song.tracks.map((t) => ({ engine: t.engine, name: t.name, vol: t.vol, pan: t.pan, delay: t.delay, reverb: t.reverb, mute: t.mute, params: t.params, pat: t.pat, notes: t.notes })) };
        localStorage.setItem(LS_KEY, JSON.stringify(clean));
      } catch (e) {}
    }, 4000);
  }

  function randomBeat() {
    const t = song.tracks[state.activeTrack];
    const n = totalSteps();
    if (t.engine === 'beatbox') {
      t.pat = t.pat.map(() => []);
      for (let s = 0; s < n; s++) {
        const inBar = s % 16;
        if (inBar === 0 || inBar === 8) t.pat[s].push(0);
        if (inBar === 4 || inBar === 12) t.pat[s].push(1);
        if (inBar % 4 === 2) t.pat[s].push(2);
        if (Math.random() < 0.14) t.pat[s].push(3);
        if (Math.random() < 0.07) t.pat[s].push(Math.random() < 0.5 ? 5 : 6);
        if (Math.random() < 0.05) t.pat[s].push(7);
      }
    } else {
      const scale = [0, 2, 3, 5, 7, 8, 10];
      const root = 48;
      t.notes = t.notes.map(() => []);
      for (let s = 0; s < n; s++) {
        if (Math.random() < 0.32) {
          const deg = scale[Math.floor(Math.random() * scale.length)];
          const oct = Math.random() < 0.25 ? 12 : 0;
          t.notes[s].push(root + deg + oct);
        }
      }
    }
    renderSeq();
    UI.toast('Случайный паттерн для «' + t.name + '»');
  }

  function showHelp() {
    const body = el('div', {}, [
      el('p', {}, ['Транспорт: ', el('b', { text: 'Space' }), ' — играть/стоп. BPM и число шагов меняются на лету.']),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Стойка' }),
      el('p', { class: 'muted', text: 'Слева — модули (машины), справа — параметры выбранного. Вращение ручек — тянуть вверх/вниз (Shift — точнее), двойной клик — значение по умолчанию. Пресеты — выпадающий список в заголовке.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Секвенсор' }),
      el('p', { class: 'muted', text: 'Для драм-машины верхняя сетка — степ-секвенсор (8 дорожек, по одной на подушку). Для мелодических машин — пиано-ролл внизу: горизонталь — время, вертикаль — высота.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'MIDI' }),
      el('p', { class: 'muted', text: 'Кнопка MIDI запрашивает доступ Web MIDI. Подключите USB-клавиатуру: ноты играют на выбранной машине, CC1 управляет срезом фильтра.' }),
      el('h4', { style: { margin: '10px 0 4px' }, text: 'Ограничения прототипа' }),
      el('p', { class: 'muted', text: 'VST-плагины браузер не поддерживает — это принципиальное ограничение веб-платформы (нет доступа к нативным модулям). Вместо них здесь встроенные машины и сэмплы. Паттерн — единственная форма клипа, как и в Caustic.' }),
    ]);
    UI.modal('Как пользоваться', body, [{ label: 'Понятно', primary: true }]);
  }

  function boot() {
    song = emptySong();
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) loadProject(JSON.parse(saved));
    } catch (e) { /* используем пустой проект */ }
    bindGlobal();
    renderAll();
    requestAnimationFrame(meterLoop);
    // первый жест включает звук
    const wake = () => { ensureAudio(); document.removeEventListener('pointerdown', wake); };
    document.addEventListener('pointerdown', wake);
  }

  // чтобы всё было в едином состоянии
  window.MS = {
    get song() { return song; },
    state,
    renderAll,
    demo: () => { song = demoSong(); refreshChannelsRebuild(); renderAll(); },
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
