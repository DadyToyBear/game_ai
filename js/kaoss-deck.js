/* Kaoss Deck — два девайса рядом (Kaossilator + miniKP2), LINK-режим,
   запись движения X-Y, анимации и «железный» вид. */
(function () {
  'use strict';

  const el = window.UI.el;
  const K = window.Kaoss;
  const KU = window.KaossUI;

  const LINK = {
    on: false,
    /* одна точка на оба девайса */
    x: 0.5,
    y: 0.5,
    /* запись движения в луп Kaossilator */
    rec: false,
    start: 0,
    path: [],           // [{t, x, y}]
  };

  const D = {};

  // ---------- общие элементы «железа» ----------
  function screw(cls) {
    return el('span', { class: 'screw ' + (cls || '') });
  }

  function led(color) {
    return el('span', { class: 'led ' + (color || '') });
  }

  function deviceChassis(kind, title, sub) {
    return el('div', { class: 'dev ' + kind }, [
      el('div', { class: 'dev-top' }, [
        screw('tl'), screw('tr'),
        el('div', { class: 'dev-brand' }, [
          el('span', { class: 'dev-mark', text: 'KORG' }),
          el('span', { class: 'dev-model', text: title }),
        ]),
        el('span', { class: 'dev-sub', text: sub }),
        el('div', { class: 'dev-vents' }, [1, 2, 3, 4, 5, 6].map(() => el('i'))),
      ]),
    ]);
  }

  // ---------- большой X-Y пэд с анимациями ----------
  D.bigPad = function (opts) {
    const root = el('div', { class: 'xy-pad big' + (opts.theme ? ' ' + opts.theme : '') }, [
      el('div', { class: 'xy-grid' }),
      el('div', { class: 'xy-ripple r1' }),
      el('div', { class: 'xy-ripple r2' }),
      el('div', { class: 'xy-hline' }),
      el('div', { class: 'xy-vline' }),
      el('div', { class: 'xy-dot' }),
      el('div', { class: 'xy-trail' }),
      el('div', { class: 'xy-label xl', text: opts.xLabel || 'X' }),
      el('div', { class: 'xy-label yl', text: opts.yLabel || 'Y' }),
      el('div', { class: 'xy-readout' }),
    ]);
    const dot = root.querySelector('.xy-dot');
    const rx = root.querySelector('.xy-ripple.r1');
    const ry = root.querySelector('.xy-ripple.r2');
    const hline = root.querySelector('.xy-hline');
    const vline = root.querySelector('.xy-vline');
    const readout = root.querySelector('.xy-readout');
    const trail = root.querySelector('.xy-trail');
    let dragging = false;
    let last = { x: 0.5, y: 0.5 };
    let points = [];

    function pos(e) {
      const r = root.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)),
      };
    }

    function paint(x, y) {
      dot.style.left = (x * 100) + '%';
      dot.style.top = ((1 - y) * 100) + '%';
      hline.style.top = ((1 - y) * 100) + '%';
      vline.style.left = (x * 100) + '%';
      rx.style.left = (x * 100) + '%'; rx.style.top = ((1 - y) * 100) + '%';
      ry.style.left = (x * 100) + '%'; ry.style.top = ((1 - y) * 100) + '%';
      readout.textContent = 'X ' + Math.round(x * 100) + ' · Y ' + Math.round(y * 100);
    }

    function paintTrail() {
      const pts = points.slice(-48);
      if (pts.length < 2) { trail.innerHTML = ''; return; }
      const d = pts.map((p, i) => (i ? 'L' : 'M') + (p.x * 100).toFixed(2) + ' ' + ((1 - p.y) * 100).toFixed(2)).join(' ');
      trail.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.2" ' +
        'stroke-linejoin="round" stroke-linecap="round" opacity="0.55" vector-effect="non-scaling-stroke"/></svg>';
    }

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch (err) {}
      dragging = true;
      last = pos(e);
      points = [last];
      paint(last.x, last.y);
      paintTrail();
      root.classList.add('active');
      root.classList.remove('pulse'); void root.offsetWidth; root.classList.add('pulse');
      if (opts.onDown) opts.onDown(last.x, last.y);
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = pos(e);
      last = p;
      points.push(p);
      paint(p.x, p.y);
      paintTrail();
      if (opts.onMove) opts.onMove(p.x, p.y);
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('active');
      if (opts.onUp) opts.onUp(last.x, last.y);
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);

    root.setXY = (x, y, ghost) => {
      last = { x, y };
      paint(x, y);
      if (ghost) root.classList.add('ghost');
      else root.classList.remove('ghost');
    };
    root.getXY = () => last;
    root.clearTrail = () => { points = []; trail.innerHTML = ''; };
    root.setTrail = (pts) => {
      points = pts.slice(-48);
      paintTrail();
      root.classList.add('replay');
      setTimeout(() => root.classList.remove('replay'), 260);
    };
    paint(0.5, 0.5);
    return root;
  };

  // ---------- Kaossilator в новом корпусе ----------
  D.kaossilator = function (inst, rerender) {
    const dev = deviceChassis('kaossilator', 'Kaossilator 2', 'DYNAMIC PHRASE SYNTHESIZER');

    // банк звуков (компактный, с категориями)
    const catRow = el('div', { class: 'dev-cats' });
    const progRow = el('div', { class: 'dev-progs' });
    let activeCat = (K.PROGRAMS[inst.prog] || {}).cat || 'bass';
    let loopBtn = null;   // кнопка «▶ луп» у слота 1 — подсветка наличия лупа

    const paintProgs = () => {
      catRow.innerHTML = '';
      progRow.innerHTML = '';
      const cats = [];
      K.PROGRAMS.forEach((p) => { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
      cats.forEach((cat) => {
        catRow.appendChild(el('button', {
          class: 'dev-cat' + (cat === activeCat ? ' active' : ''),
          text: K.CAT_NAMES[cat] || cat,
          onclick: () => { activeCat = cat; paintProgs(); },
        }));
      });
      K.PROGRAMS.forEach((p, i) => {
        if (p.cat !== activeCat) return;
        progRow.appendChild(el('button', {
          class: 'dev-prog' + (inst.prog === i ? ' active' : '') + (p.loop ? ' loop' : '') + (p.drum ? ' drum' : ''),
          text: p.name,
          onclick: () => {
            inst.setProgram(i);
            octSel.value = inst.octave;
            paintProgs();
            onProgramChange();
            if (inst.__refreshLoops) inst.__refreshLoops();
          },
        }));
      });
    };

    const lcdName = el('div', { class: 'lcd-name', text: K.PROGRAMS[inst.prog].name });
    const lcdNote = el('div', { class: 'lcd-note', text: '— —' });
    const lcdOct = el('div', { class: 'lcd-oct', text: 'OCT ' + inst.octave });

    function onProgramChange() {
      const p = K.PROGRAMS[inst.prog];
      lcdName.textContent = p.name;
      lcdOct.textContent = 'OCT ' + inst.octave;
      if (loopBtn) loopBtn.classList.toggle('has', !!p.loop);
    }

    const scaleSel = el('select', { class: 'dev-select', onchange: (e) => { inst.scale = e.target.value; } },
      Object.keys(K.SCALES).map((k) => el('option', { value: k, text: KU.SCALE_NAMES[k] || k })));
    scaleSel.value = inst.scale;

    const octSel = el('select', { class: 'dev-select', onchange: (e) => { inst.octave = Number(e.target.value); lcdOct.textContent = 'OCT ' + inst.octave; } },
      [2, 3, 4, 5, 6].map((o) => el('option', { value: o, text: 'OCT ' + o })));
    octSel.value = inst.octave;

    const holdBtn = el('button', {
      class: 'dev-btn', text: 'HOLD',
      onclick: () => {
        const on = inst.setHold(!inst.hold);
        holdBtn.classList.toggle('on', on);
        pad.classList.toggle('holdon', on);
      },
    });

    const pad = D.bigPad({
      theme: 'kaoss',
      xLabel: 'X · NOTE',
      yLabel: 'Y · TONE',
      onDown: (x, y) => {
        inst.noteOn(x, y, 0.9);
        lcdNote.textContent = noteName(inst.midi);
        if (LINK.rec) LINK.addPoint(x, y);
        if (LINK.on) LINK.push(x, y, 'kaoss');
      },
      onMove: (x, y) => {
        inst.move(x, y);
        lcdNote.textContent = noteName(inst.midi);
        if (LINK.rec) LINK.addPoint(x, y);
        if (LINK.on) LINK.push(x, y, 'kaoss');
      },
      onUp: () => {
        if (!inst.hold) { inst.noteOff(); }
        if (LINK.rec) LINK.addPoint(pad.getXY().x, pad.getXY().y, true);
      },
    });

    // лупы
    const loopRows = el('div', { class: 'dev-loops' });
    const loopRefreshers = [];
    [0, 1].forEach((slot) => {
      const state = el('span', { class: 'dev-pill', text: 'пусто' });
      const rec = el('button', { class: 'dev-btn rec', text: '●' });
      const preset = el('button', { class: 'dev-btn', text: '▶ луп' });
      const clear = el('button', { class: 'dev-btn ghost', text: '✕' });

      const refresh = () => {
        const has = !!inst.loops[slot];
        state.textContent = inst.recSlot === slot ? 'REC…' : (has ? 'LOOP ' + (slot + 1) : 'пусто');
        state.classList.toggle('on', has || inst.recSlot === slot);
        rec.classList.toggle('on', inst.recSlot === slot);
        preset.classList.toggle('on', !!(inst.playingLoops[slot] && inst.loopFromProgram === slot));
      };

      if (slot === 0) loopBtn = preset;
      rec.addEventListener('click', () => {
        if (inst.recSlot === slot) inst.stopRec(); else inst.startRec(slot);
        refresh();
        document.querySelectorAll('.dev-loops .dev-btn.rec').forEach((b, i) => b.classList.toggle('on', inst.recSlot === i));
      });
      preset.addEventListener('click', () => {
        if (!inst.programLoop()) { window.UI.toast('У этого звука нет готового лупа — запишите свой через ●', 'error'); return; }
        if (inst.playingLoops[slot] && inst.loopFromProgram === slot) inst.stopLoop(slot);
        else { inst.loopFromProgram = slot; inst.startProgramLoop(slot); }
        refresh();
      });
      clear.addEventListener('click', () => { inst.clearLoop(slot); refresh(); });

      loopRows.appendChild(el('div', { class: 'dev-loop' }, [
        el('span', { class: 'dev-loop-no', text: String(slot + 1) }),
        rec, preset, clear, state,
        el('button', {
          class: 'dev-btn ghost', text: '→ паттерн',
          onclick: () => {
            if (!inst.loops[slot] || !inst.loops[slot].length) { window.UI.toast('Сначала запишите фразу', 'error'); return; }
            KU.loopToProject(inst, slot);
          },
        }),
      ]));
      refresh();
      loopRefreshers.push(refresh);
    });
    inst.__refreshLoops = () => loopRefreshers.forEach((fn) => fn());

    paintProgs();
    onProgramChange();

    dev.appendChild(el('div', { class: 'dev-screen' }, [
      el('div', { class: 'lcd' }, [lcdName, el('div', { class: 'lcd-row' }, [lcdNote, lcdOct])]),
      el('div', { class: 'lcd-side' }, [led('rec'), led('on')]),
    ]));
    dev.appendChild(el('div', { class: 'dev-ctrl' }, [
      el('label', { class: 'dev-lbl', text: 'SCALE' }), scaleSel,
      el('label', { class: 'dev-lbl', text: 'OCT' }), octSel,
      holdBtn,
      el('button', {
        class: 'dev-btn ghost', text: 'RESET',
        onclick: () => {
          inst.hold = false; holdBtn.classList.remove('on');
          pad.classList.remove('holdon');
          inst.noteOff(true);
          inst.lastMidi = null;
          pad.setXY(0.5, 0.5);
          pad.clearTrail();
          lcdNote.textContent = '— —';
        },
      }),
    ]));
    dev.appendChild(el('div', { class: 'dev-body' }, [pad]));
    dev.appendChild(el('div', { class: 'dev-bank-block' }, [catRow, progRow]));
    dev.appendChild(loopRows);

    /* --- свои сэмплы: WAV/MP3 → слайсы (как у железа, загрузка со своих записей) --- */
    inst.ensureSampler();
    const sampleBox = el('div', { class: 'dev-samples' });
    const paintSamples = () => {
      sampleBox.innerHTML = '';
      const has = inst.sampler && inst.sampler.buffer;
      sampleBox.appendChild(el('div', { class: 'dev-ctrl' }, [
        el('span', { class: 'dev-lbl', text: 'СЭМПЛЫ' }),
        el('span', { class: 'dev-pill' + (has ? ' on' : ''), text: has ? String(inst.sampler.name).slice(0, 18) : 'не загружен' }),
      ]));
      const loader = KU.loadAudioDialog('Загрузить сэмпл', (buf, name) => {
        inst.loadSample(buf, name);
        paintSamples();
        lcdName.textContent = name.slice(0, 18).toUpperCase();
      });
      sampleBox.appendChild(loader.node);

      const modeSel = el('select', { class: 'dev-select', onchange: (e) => { inst.mode = e.target.value; } }, [
        el('option', { value: 'synth', text: 'СИНТЕЗ' }),
        el('option', { value: 'sampler', text: 'СЛАЙСЫ' }),
      ]);
      modeSel.value = inst.mode;
      const xmode = el('select', {
        class: 'dev-select',
        onchange: (e) => { inst.sampler.xMode = e.target.value; inst.sampler.sliceMode = e.target.value === 'slice'; },
      }, [
        el('option', { value: 'slice', text: 'X: слайс' }),
        el('option', { value: 'pitch', text: 'X: питч' }),
        el('option', { value: 'speed', text: 'X: скорость' }),
      ]);
      xmode.value = inst.sampler.xMode;
      sampleBox.appendChild(el('div', { class: 'dev-ctrl' }, [modeSel, xmode]));

      if (has) {
        const map = el('div', { class: 'dev-slice-map' });
        inst.sampler.slices.forEach((sl, i) => {
          map.appendChild(el('div', {
            class: 'dev-slice',
            style: { width: ((sl.end - sl.start) * 100) + '%' },
            title: 'Слайс ' + (i + 1),
            onclick: () => inst.sampler.play((i + 0.5) / inst.sampler.slices.length, 0.8, 0.9, null),
          }, [el('span', { text: String(i + 1) })]));
        });
        sampleBox.appendChild(map);
        sampleBox.appendChild(el('div', { class: 'dev-ctrl' }, [
          el('button', { class: 'dev-btn', text: '▶ 1-й', onclick: () => inst.sampler.play(0, 0.8, 0.9, null) }),
          el('button', {
            class: 'dev-btn ghost', text: 'резка', title: 'Нарезать ровно на 8 слайсов',
            onclick: () => { inst.sampler.sliceByGrid(8); paintSamples(); },
          }),
          el('button', { class: 'dev-btn ghost', text: '■', onclick: () => inst.sampler.stopAll() }),
        ]));
      }
    };
    paintSamples();
    dev.appendChild(sampleBox);

    dev.lcdNote = lcdNote;
    dev.refreshLoops = () => inst.__refreshLoops && inst.__refreshLoops();
    return dev;
  };

  // ---------- mini Kaoss Pad 2 в новом корпусе ----------
  D.kaossPad = function (fx, rerender) {
    const dev = deviceChassis('kaoss-pad', 'mini Kaoss Pad 2', 'DYNAMIC EFFECT PROCESSOR');

    const progGrid = el('div', { class: 'fx-pads' });
    const progLabel = el('div', { class: 'lcd-name', text: fx.programs[fx.program].name });
    const progTag = el('div', { class: 'lcd-oct', text: fx.programs[fx.program].tag });

    const paintProgs = () => {
      progGrid.innerHTML = '';
      fx.programs.forEach((p, i) => {
        progGrid.appendChild(el('button', {
          class: 'fx-pad' + (fx.program === i ? ' active' : ''),
          onclick: () => {
            fx.setProgram(i);
            progLabel.textContent = p.name;
            progTag.textContent = p.tag;
            paintProgs();
          },
          title: p.name,
        }, [el('span', { class: 'fx-pad-num', text: String(i + 1).padStart(2, '0') })]));
      });
    };

    const holdBtn = el('button', {
      class: 'dev-btn', text: 'HOLD',
      onclick: () => {
        const on = fx.setHold(!fx.hold);
        holdBtn.classList.toggle('on', on);
        pad.classList.toggle('holdon', on);
        if (!on) fx.releaseXY();
      },
    });

    const pad = D.bigPad({
      theme: 'fxpad',
      xLabel: 'X · PARAM',
      yLabel: 'Y · DEPTH',
      onDown: (x, y) => {
        fx.setXY(x, y);
        if (LINK.on) LINK.push(x, y, 'fx');
      },
      onMove: (x, y) => {
        fx.setXY(x, y);
        if (LINK.on) LINK.push(x, y, 'fx');
      },
      onUp: () => { if (!fx.hold) fx.releaseXY(); },
    });

    // плеер
    const playerBox = el('div', { class: 'dev-player' });
    const paintPlayer = () => {
      playerBox.innerHTML = '';
      const has = fx.player && fx.player.buffer;
      const loader = KU.loadAudioDialog('Загрузить в плеер', (buf, name) => { fx.loadAudio(buf, name); paintPlayer(); });
      playerBox.appendChild(el('div', { class: 'dev-player-head' }, [
        el('span', { class: 'dev-pill' + (has ? ' on' : ''), text: has ? fx.player.name.slice(0, 16) : 'нет файла' }),
      ]));
      playerBox.appendChild(loader.node);
      if (has) {
        const pitch = el('input', {
          class: 'dev-range', type: 'range', min: '-24', max: '24', step: '1', value: '0',
          oninput: (e) => {
            const v = Number(e.target.value);
            fx.setPitch(v);
            pv.textContent = (v > 0 ? '+' : '') + v;
          },
        });
        const pv = el('span', { class: 'dev-pill', text: '0' });
        playerBox.appendChild(el('div', { class: 'dev-player-row' }, [
          el('button', { class: 'dev-btn', text: '▶', onclick: () => fx.playSample(Math.pow(2, Number(pitch.value) / 12), false) }),
          el('button', { class: 'dev-btn', text: '⟲', title: 'Зациклить', onclick: () => fx.playSample(Math.pow(2, Number(pitch.value) / 12), true) }),
          el('button', { class: 'dev-btn ghost', text: '■', onclick: () => fx.stopSample() }),
          el('label', { class: 'dev-lbl', text: 'PITCH' }), pitch, pv,
        ]));
      }
    };
    paintProgs();
    paintPlayer();

    dev.appendChild(el('div', { class: 'dev-screen' }, [
      el('div', { class: 'lcd' }, [progLabel, el('div', { class: 'lcd-row' }, [progTag])]),
      el('div', { class: 'lcd-side' }, [led('on')]),
    ]));
    dev.appendChild(el('div', { class: 'dev-ctrl' }, [holdBtn, el('button', {
      class: 'dev-btn ghost', text: 'RESET',
      onclick: () => { fx.reset(); pad.setXY(0.5, 0.5); pad.classList.remove('active'); },
    })]));
    dev.appendChild(el('div', { class: 'dev-body' }, [pad]));
    dev.appendChild(progGrid);
    dev.appendChild(playerBox);
    return { node: dev, pad };
  };

  // ---------- LINK: одна точка на оба девайса ----------
  LINK.push = function (x, y, from) {
    if (!LINK.on) return;
    LINK.x = x; LINK.y = y;
    const deck = document.getElementById('deckGrid');
    if (!deck) return;
    const host = deck.parentNode || document;
    const fx = window.MS.state.kaossFX;
    // зеркалим на другой девайс
    if (from === 'kaoss') {
      if (fx) fx.setXY(x, y);
      const other = deck.querySelector('.dev.kaoss-pad .xy-pad');
      if (other) other.setXY(x, y, true);
    } else {
      const instPad = deck.querySelector('.dev.kaossilator .xy-pad');
      if (instPad) instPad.setXY(x, y, true);
    }
    const meters = host.querySelectorAll('.link-meter i');
    meters.forEach((m) => { m.style.width = Math.round(x * 100) + '%'; });
  };

  LINK.addPoint = function (x, y, end) {
    if (!LINK.rec) return;
    const t = (window.MS.state.ctx ? window.MS.state.ctx.currentTime : performance.now() / 1000) - LINK.start;
    LINK.path.push({ t, x, y, end: !!end });
  };

  LINK.startRec = function () {
    LINK.rec = true;
    LINK.path = [];
    LINK.start = window.MS.state.ctx ? window.MS.state.ctx.currentTime : performance.now() / 1000;
  };

  LINK.stopRec = function () {
    LINK.rec = false;
    return LINK.path.slice();
  };

  /* Сохранить записанное движение в луп инструмента как сегмент «путь» */
  LINK.toLoop = function (inst, slot) {
    if (!LINK.path.length) return 0;
    const segs = LINK.path.map((p) => ({
      t0: Math.max(0, p.t), t1: Math.max(0.05, p.t + 0.18),
      midi: inst.quantize(p.x), x: p.x, y: p.y, v: 0.9, mode: inst.mode,
    }));
    inst.recSlot = -1;
    inst.loops[slot] = segs;
    inst.loopFromProgram = -1;
    inst.startLoop(slot);
    if (inst.__refreshLoops) inst.__refreshLoops();
    return segs.length;
  };

  // ---------- Сборка всей деки ----------
  D.render = function (host) {
    const MS = window.MS;
    const inst = MS.state.kaossInst;
    const fx = MS.state.kaossFX;
    if (!host) return;
    host.innerHTML = '';
    if (!inst || !fx) {
      host.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: 'Kaoss Deck' }),
        el('p', { class: 'muted', text: 'Нажмите кнопку, чтобы включить аудио-движок.' }),
        el('div', { class: 'row' }, [el('button', {
          class: 'btn primary', text: 'Включить звук',
          onclick: () => { MS.ensureAudio(); MS.renderKaoss(); },
        })]),
      ]));
      return;
    }

    // панель LINK
    const linkBtn = el('button', {
      class: 'link-btn' + (LINK.on ? ' on' : ''),
      text: 'LINK',
      title: 'Одно движение управляет Kaossilator и miniKP2 одновременно',
      onclick: () => {
        LINK.on = !LINK.on;
        linkBtn.classList.toggle('on', LINK.on);
        const dk = document.getElementById('deckGrid');
        if (dk) {
          dk.classList.toggle('linked', LINK.on);
          if (!LINK.on) dk.querySelectorAll('.xy-pad.ghost').forEach((p) => p.classList.remove('ghost'));
        }
        window.UI.toast(LINK.on ? 'LINK включён: пэды двигаются вместе' : 'LINK выключен');
      },
    });

    const recBtn = el('button', {
      class: 'link-btn rec' + (LINK.rec ? ' on' : ''),
      text: 'REC XY',
      title: 'Записать движение пальца по пэду',
      onclick: async () => {
        if (!LINK.rec) {
          LINK.startRec();
          recBtn.classList.add('on');
          recBtn.textContent = 'REC…';
          window.UI.toast('Запись движения пошла — водите по пэду', 'ok');
        } else {
          const path = LINK.stopRec();
          recBtn.classList.remove('on');
          recBtn.textContent = 'REC XY';
          window.UI.toast('Записано точек: ' + path.length + '. Нажмите «В луп» чтобы зациклить.', 'ok');
        }
      },
    });

    const toLoopBtn = el('button', {
      class: 'link-btn', text: 'В ЛУП',
      title: 'Превратить записанное движение в луп Kaossilator',
      onclick: () => {
        if (!LINK.path.length) { window.UI.toast('Сначала запишите движение (REC XY)', 'error'); return; }
        const n = LINK.toLoop(inst, 0);
        window.UI.toast('Луп из ' + n + ' точек записан в LOOP 1 и играет', 'ok');
        if (inst.__refreshLoops) inst.__refreshLoops();
        D.render(host);
      },
    });

    const clearTrail = el('button', {
      class: 'link-btn', text: 'CLEAR',
      onclick: () => {
        LINK.path = [];
        document.querySelectorAll('.xy-trail').forEach((t) => { t.innerHTML = ''; });
        window.UI.toast('Движение очищено');
      },
    });

    const bar = el('div', { class: 'deck-bar' }, [
      el('div', { class: 'deck-title' }, [
        el('span', { class: 'dev-mark', text: 'KAOSS DECK' }),
        el('span', { class: 'hint', text: 'синтезатор + эффект-процессор, как два прибора на столе' }),
      ]),
      el('div', { class: 'deck-tools' }, [linkBtn, recBtn, toLoopBtn, clearTrail]),
      el('div', { class: 'link-meter' }, [el('i')]),
    ]);

    const deck = el('div', { class: 'deck' + (LINK.on ? ' linked' : ''), id: 'deckGrid' });

    const kDev = D.kaossilator(inst, () => D.render(host));
    const fObj = D.kaossPad(fx, () => D.render(host));

    deck.appendChild(kDev);
    deck.appendChild(fObj.node);

    host.appendChild(bar);
    host.appendChild(deck);

    // держим индикаторы лупов в актуальном состоянии (один таймер на деку)
    if (D._timer) { clearInterval(D._timer); D._timer = null; }
    D._timer = setInterval(() => {
      if (!document.body.contains(kDev)) { clearInterval(D._timer); D._timer = null; return; }
      if (kDev.refreshLoops) kDev.refreshLoops();
      if (LINK.on) {
        document.querySelectorAll('.link-meter i').forEach((m) => { m.style.width = Math.round(LINK.x * 100) + '%'; });
      }
    }, 600);
  };

  function noteName(midi) {
    const names = ['C', 'C-', 'D', 'D-', 'E', 'F', 'F-', 'G', 'G-', 'A', 'A-', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  window.KaossDeck = D;
  window.KaossLink = LINK;
})();
