/* Интерфейс Kaoss-модулей: X-Y пэды, лупы, программы эффектов */
(function () {
  'use strict';

  const el = window.UI.el;
  const KU = {};

  /* X-Y пэд. Возвращает {el, setXY, dot} — точка двигается извне для отрисовки */
  KU.pad = function (opts) {
    opts = opts || {};
    const root = el('div', { class: 'xy-pad' }, [
      el('div', { class: 'xy-grid' }),
      el('div', { class: 'xy-cross-x' }),
      el('div', { class: 'xy-cross-y' }),
      el('div', { class: 'xy-dot' }),
      el('div', { class: 'xy-label xl', text: opts.xLabel || 'X' }),
      el('div', { class: 'xy-label yl', text: opts.yLabel || 'Y' }),
      el('div', { class: 'xy-readout' }),
    ]);
    const dot = root.querySelector('.xy-dot');
    const readout = root.querySelector('.xy-readout');
    let dragging = false;
    let last = { x: 0.5, y: 0.5 };

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
      readout.textContent = 'X ' + Math.round(x * 100) + ' · Y ' + Math.round(y * 100);
    }

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* jsdom/старые браузеры */ }
      dragging = true;
      last = pos(e);
      paint(last.x, last.y);
      if (opts.onDown) opts.onDown(last.x, last.y);
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = pos(e);
      last = p;
      paint(p.x, p.y);
      if (opts.onMove) opts.onMove(p.x, p.y);
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (opts.onUp) opts.onUp(last.x, last.y);
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('pointerleave', (e) => { if (dragging && e.buttons === 0) up(); });

    root.setXY = (x, y) => { last = { x, y }; paint(x, y); };
    root.getXY = () => last;
    paint(0.5, 0.5);
    if (opts.hold) root.classList.add('hold');
    return root;
  };

  /* Диалог загрузки аудиофайла: WAV / MP3 / OGG / FLAC (что умеет браузер) */
  KU.loadAudioDialog = function (title, onLoaded) {
    const box = el('div', {});
    const info = el('div', { class: 'hint' });
    const input = el('input', {
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aiff,.aif',
      style: { display: 'none' },
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        info.textContent = 'Декодирую ' + f.name + '…';
        try {
          const ctx = window.MS.ensureAudio ? window.MS.ensureAudio() : (window.MS.state.ctx || new (window.AudioContext)());
          const arr = await f.arrayBuffer();
          const buf = await ctx.decodeAudioData(arr.slice(0));
          info.textContent = 'Готово: ' + f.name + ' · ' + buf.duration.toFixed(2) + ' с · ' +
            buf.sampleRate + ' Гц · ' + buf.numberOfChannels + ' кан.';
          onLoaded(buf, f.name);
        } catch (err) {
          info.textContent = 'Не удалось декодировать: ' + err.message +
            '. Поддерживаются WAV/MP3/OGG — формат должен читаться браузером.';
        }
      },
    });
    box.appendChild(el('p', {
      class: 'muted',
      text: 'Можно грузить WAV (любая частота/битность, как у железа), MP3, OGG, M4A. Файл остаётся в памяти вкладки; для проекта сохраняется только ссылка на имя, сами аудиоданные не пишутся в JSON.',
    }));
    box.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', text: 'Выбрать файл', onclick: () => input.click() }),
      input,
    ]));
    box.appendChild(info);
    return { node: box, input };
  };

  /* ---------- Kaossilator ---------- */
  KU.instrumentPanel = function (inst, onLayoutChange) {
    const wrap = el('div', { class: 'kaoss' });
    let rebuildSampleCard = null;
    const refreshHost = () => { if (rebuildSampleCard) rebuildSampleCard(); if (onLayoutChange) onLayoutChange(); };

    const head = el('div', { class: 'kaoss-head' }, [
      el('div', { class: 'kaoss-title' }, [
        el('span', { class: 'kaoss-badge', text: 'XY' }),
        el('div', {}, [
          el('div', { class: 'machine-title', text: 'Kaossilator 2 — Dynamic Phrase Synth' }),
          el('div', { class: 'machine-desc', text: 'X — нота по гамме, Y — яркость/срез. Запись фраз в два лупа.' }),
        ]),
      ]),
      el('div', { class: 'spacer' }),
    ]);

    /* --- Банк звуков: категории как на Kaossilator --- */
    const progBar = el('div', { class: 'prog-bar' });
    const renderProgs = () => {
      progBar.innerHTML = '';
      const cats = [];
      Kaoss.PROGRAMS.forEach((p, i) => { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
      cats.forEach((cat) => {
        const group = el('div', { class: 'prog-group' }, [
          el('div', { class: 'prog-cat', text: Kaoss.CAT_NAMES[cat] || cat }),
        ]);
        const row = el('div', { class: 'prog-row' });
        Kaoss.PROGRAMS.forEach((p, i) => {
          if (p.cat !== cat) return;
          row.appendChild(el('button', {
            class: 'prog-btn' + (inst.prog === i ? ' active' : '') + (p.drum ? ' drum' : '') + (p.loop ? ' loop' : ''),
            'data-i': i,
            title: (p.engine || (p.drum ? 'beatbox' : '')) + (p.loop ? ' · со встроенным лупом' : ''),
            onclick: () => {
              inst.setProgram(i);
              renderProgs();
              progName.textContent = p.name;
              octSel.value = String(inst.octave);
              // встроенный луп — сразу предложить запуск
              loopHint.textContent = p.loop ? 'у звука есть встроенный луп — ▶ в лупе' : '';
              loopHint.style.display = p.loop ? '' : 'none';
            },
          }, [el('span', { text: p.name })]));
        });
        group.appendChild(row);
        progBar.appendChild(group);
      });
    };
    const progName = el('div', { class: 'prog-current', text: Kaoss.PROGRAMS[inst.prog].name });
    const loopHint = el('span', { class: 'hint', style: { display: 'none' } });

    // контролы
    const scaleSel = el('select', { class: 'preset-select', onchange: (e) => { inst.scale = e.target.value; } },
      Object.keys(Kaoss.SCALES).map((k) => el('option', { value: k, text: SCALE_NAMES[k] || k })));
    scaleSel.value = inst.scale;

    const waveSel = el('select', { class: 'preset-select', onchange: (e) => { inst.wave = e.target.value; } },
      [['sawtooth', 'Пила'], ['square', 'Квадрат'], ['triangle', 'Три'], ['sine', 'Синус']]
        .map(([v, n]) => el('option', { value: v, text: n })));
    waveSel.value = inst.wave;

    const octSel = el('select', { class: 'preset-select', onchange: (e) => { inst.octave = Number(e.target.value); } },
      [3, 4, 5, 6].map((o) => el('option', { value: o, text: 'OCT ' + o })));
    octSel.value = inst.octave;

    head.appendChild(el('label', { class: 'hint', text: 'Звук' }));
    head.appendChild(progName);
    head.appendChild(loopHint);

    head.appendChild(el('label', { class: 'hint', text: 'Гамма' }));
    head.appendChild(scaleSel);
    head.appendChild(el('label', { class: 'hint', text: 'Волна' }));
    head.appendChild(waveSel);
    head.appendChild(el('label', { class: 'hint', text: 'Октава' }));
    head.appendChild(octSel);

    // пэд
    const readout = el('div', { class: 'kaoss-note', text: '—' });
    const pad = KU.pad({
      xLabel: 'X · НОТА',
      yLabel: 'Y · ТЕМБР',
      onDown: (x, y) => {
        const midi = inst.noteOn(x, y, 0.9);
        readout.textContent = noteName(midi);
        pad.classList.add('active');
      },
      onMove: (x, y) => {
        const midi = inst.move(x, y);
        readout.textContent = noteName(midi);
      },
      onUp: () => {
        if (!inst.hold) {
          inst.noteOff();
          pad.classList.remove('active');
        } else {
          pad.classList.add('holdon');
        }
      },
    });

    const holdBtn = el('button', {
      class: 'btn mini hold',
      text: 'HOLD',
      title: 'Фиксация: нота остаётся после отпускания (как на железе)',
      onclick: () => {
        const on = inst.setHold(!inst.hold);
        holdBtn.classList.toggle('on', on);
        pad.classList.toggle('holdon', on);
        if (on) readout.textContent = noteName(inst.midi);
      },
    });
    head.appendChild(holdBtn);

    // лупы
    const loopBox = el('div', { class: 'loop-box' });
    [0, 1].forEach((slot) => {
      const state = el('span', { class: 'pill', text: 'пусто' });
      const rec = el('button', { class: 'btn rec mini', text: '●', title: 'Записать фразу' });
      const play = el('button', { class: 'btn mini', text: '▶', title: 'Играть луп' });
      const clr = el('button', { class: 'btn ghost mini', text: '✕', title: 'Стереть' });

      const refresh = () => {
        const has = !!inst.loops[slot];
        state.textContent = inst.recSlot === slot ? 'запись…' : (has ? 'записан' : 'пусто');
        state.className = 'pill' + (has ? ' ok' : '') + (inst.recSlot === slot ? ' rec' : '');
        play.classList.toggle('on', !!inst.playingLoops[slot]);
      };

      rec.addEventListener('click', () => {
        if (inst.recSlot === slot) { inst.stopRec(); }
        else { inst.startRec(slot); }
        refresh();
        document.querySelectorAll('.loop-box .btn.rec.mini').forEach((b, i) => b.classList.toggle('on', inst.recSlot === i));
      });
      play.addEventListener('click', () => {
        if (inst.playingLoops[slot]) inst.stopLoop(slot);
        else inst.startLoop(slot);
        refresh();
      });
      clr.addEventListener('click', () => { inst.clearLoop(slot); refresh(); });

      const toPat = el('button', {
        class: 'btn ghost mini',
        text: '→ Паттерн',
        title: 'Перенести фразу лупа в активную машину как обычные ноты',
        onclick: () => {
          if (!inst.loops[slot] || !inst.loops[slot].length) { window.UI.toast('Сначала запишите фразу в луп', 'error'); return; }
          KU.loopToProject(inst, slot);
        },
      });

      const presetPlay = el('button', {
        class: 'btn ghost mini preset',
        text: '▶ луп',
        title: 'Играть встроенный луп выбранного звука (если он есть)',
        onclick: () => {
          if (!inst.programLoop()) { window.UI.toast('У этого звука нет встроенного лупа — запишите свой через ●', 'error'); return; }
          if (inst.playingLoops[slot] && inst.loopFromProgram === slot) inst.stopLoop(slot);
          else { inst.loopFromProgram = slot; inst.startProgramLoop(slot); }
          presetPlay.classList.toggle('on', !!(inst.playingLoops[slot] && inst.loopFromProgram === slot));
          refresh();
        },
      });

      loopBox.appendChild(el('div', { class: 'loop-row' }, [
        el('span', { class: 'loop-num', text: 'LOOP ' + (slot + 1) }),
        rec, presetPlay, play, clr, state, toPat,
      ]));
    });

    const side = el('div', { class: 'kaoss-side' }, [
      readout,
      pad,
      el('div', { class: 'hint', text: 'Тяните палец по пэду — нота идёт по гамме, вертикаль меняет тембр.' }),
      loopBox,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost mini', text: 'Стоп всё', onclick: () => { inst.stopAll(); document.querySelectorAll('.loop-box .btn').forEach((b) => b.classList.remove('on')); } }),
      ]),
    ]);

    /* --- своя библиотека сэмплов: WAV/MP3 → слайсы --- */
    renderProgs();
    inst.ensureSampler();
    const sampleCard = el('div', { class: 'sample-card' });
    rebuildSampleCard = () => {
      sampleCard.innerHTML = '';
      const has = inst.sampler && inst.sampler.buffer;
      sampleCard.appendChild(el('div', { class: 'sample-head' }, [
        el('span', { class: 'pill' + (has ? ' ok' : ''), text: has ? inst.sampler.name : 'сэмпл не загружен' }),
        has ? el('span', { class: 'hint', text: inst.sampler.buffer.duration.toFixed(2) + ' с · ' + inst.sampler.slices.length + ' слайс(ов)' }) : null,
      ]));

      const loader = KU.loadAudioDialog('Загрузить сэмпл', (buf, name) => {
        inst.loadSample(buf, name);
        rebuildSampleCard();
      });
      sampleCard.appendChild(loader.node);

      {
        const modeSel = el('select', { class: 'preset-select', onchange: (e) => { inst.mode = e.target.value; } }, [
          el('option', { value: 'synth', text: 'Синтез (X-Y)' }),
          el('option', { value: 'sampler', text: 'Сэмплы (слайсы)' }),
        ]);
        modeSel.value = inst.mode;
        sampleCard.appendChild(el('div', { class: 'row' }, [
          el('label', { class: 'hint', text: 'Режим пэда' }), modeSel,
        ]));

        const xmode = el('select', {
          class: 'preset-select',
          onchange: (e) => { inst.sampler.xMode = e.target.value; inst.sampler.sliceMode = e.target.value === 'slice'; },
        }, [
          el('option', { value: 'slice', text: 'X — слайс' }),
          el('option', { value: 'pitch', text: 'X — питч (+12 ст)' }),
          el('option', { value: 'speed', text: 'X — скорость ×0.5…×2' }),
        ]);
        xmode.value = inst.sampler.xMode;
        sampleCard.appendChild(el('div', { class: 'row' }, [el('label', { class: 'hint', text: 'Что делает X' }), xmode]));

        // нарезка
        const nSel = el('input', { type: 'number', min: '1', max: '32', value: String(inst.sampler.slices.length), class: 'preset-select', style: { width: '70px' } });
        sampleCard.appendChild(el('div', { class: 'row' }, [
          el('label', { class: 'hint', text: 'Слайсов' }), nSel,
          el('button', {
            class: 'btn mini', text: 'Ровно',
            onclick: () => { inst.sampler.sliceByGrid(Number(nSel.value) || 8); refreshHost(); },
          }),
          el('button', {
            class: 'btn mini', text: 'По пикам',
            onclick: () => { inst.sampler.sliceByPeaks(Number(nSel.value) || 8); refreshHost(); },
          }),
        ]));

        // карта слайсов
        const map = el('div', { class: 'slice-map' });
        inst.sampler.slices.forEach((sl, i) => {
          map.appendChild(el('div', {
            class: 'slice',
            style: { width: ((sl.end - sl.start) * 100) + '%' },
            title: 'Слайс ' + (i + 1),
            onclick: () => { inst.sampler.play((i + 0.5) / inst.sampler.slices.length, 0.8, 0.9, null); },
          }, [el('span', { text: String(i + 1) })]));
        });
        sampleCard.appendChild(map);

        sampleCard.appendChild(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn mini', text: '▶ Проверить 1-й',
            onclick: () => inst.sampler.play(0, 0.8, 0.9, null),
          }),
          el('button', { class: 'btn ghost mini', text: 'Стоп', onclick: () => inst.sampler.stopAll() }),
        ]));
      }
    };
    rebuildSampleCard();

    wrap.appendChild(head);
    wrap.appendChild(progBar);
    wrap.appendChild(el('div', { class: 'kaoss-body' }, [side, sampleCard]));
    return wrap;
  };

  /* ---------- mini Kaoss Pad 2 ---------- */
  KU.fxPanel = function (fx, mixer, onChange) {
    const wrap = el('div', { class: 'kaoss' });

    const progGrid = el('div', { class: 'fx-grid' });
    fx.programs.forEach((p, i) => {
      progGrid.appendChild(el('button', {
        class: 'fx-btn' + (fx.program === i ? ' active' : ''),
        'data-i': i,
        onclick: () => {
          fx.setProgram(i);
          progGrid.querySelectorAll('.fx-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === i));
          nameEl.textContent = p.name;
          tagEl.textContent = p.tag;
          pad.setXY(fx.x, fx.y);
        },
      }, [el('span', { class: 'fx-num', text: String(i + 1).padStart(2, '0') }), el('span', { text: p.name })]));
    });

    const nameEl = el('div', { class: 'fx-name', text: fx.programs[fx.program].name });
    const tagEl = el('span', { class: 'pill', text: fx.programs[fx.program].tag });

    const pad = KU.pad({
      xLabel: 'X · ЧАСТОТА/СКОРОСТЬ',
      yLabel: 'Y · ГЛУБИНА/РЕЗОНАНС',
      onDown: (x, y) => { fx.setXY(x, y); pad.classList.add('active'); },
      onMove: (x, y) => { fx.setXY(x, y); },
      onUp: () => {
        pad.classList.remove('active');
        if (!fx.hold) fx.releaseXY();
      },
    });

    const holdBtn = el('button', {
      class: 'btn mini hold',
      text: 'HOLD',
      title: 'Зафиксировать позицию X-Y (как на miniKP2)',
      onclick: () => {
        const on = fx.setHold(!fx.hold);
        holdBtn.classList.toggle('on', on);
        pad.classList.toggle('holdon', on);
        if (!on) fx.releaseXY();
      },
    });

    const head2 = el('div', { class: 'kaoss-head' }, [
      el('div', { class: 'kaoss-title' }, [
        el('span', { class: 'kaoss-badge fx', text: 'FX' }),
        el('div', {}, [
          el('div', { class: 'machine-title', text: 'mini Kaoss Pad 2 — Dynamic FX Processor' }),
          el('div', { class: 'machine-desc', text: 'Процессор на мастер-шине: 12 программ, управление X-Y как на железе.' }),
        ]),
      ]),
      el('div', { class: 'spacer' }),
      nameEl, tagEl,
      holdBtn,
      el('button', { class: 'btn ghost mini', text: 'Сброс', onclick: () => { fx.reset(); pad.setXY(0.5, 0.5); pad.classList.remove('active'); } }),
    ]);

    /* --- плеер своих сэмплов (MP3/WAV) с pitch adjust, как у miniKP2 --- */
    const playerCard = el('div', { class: 'sample-card' });
    const rebuildPlayer = () => {
      playerCard.innerHTML = '';
      const has = fx.player && fx.player.buffer;
      const loader = KU.loadAudioDialog('Загрузить в плеер', (buf, name) => { fx.loadAudio(buf, name); rebuildPlayer(); });
      playerCard.appendChild(el('div', { class: 'sample-head' }, [
        el('span', { class: 'pill' + (has ? ' ok' : ''), text: has ? fx.player.name : 'плеер пуст' }),
        has ? el('span', { class: 'hint', text: fx.player.buffer.duration.toFixed(2) + ' с · ' + fx.player.buffer.sampleRate + ' Гц' }) : null,
      ]));
      playerCard.appendChild(loader.node);

      {
        const pitch = el('input', {
          class: 'rng', type: 'range', min: '-24', max: '24', step: '1', value: '0',
          oninput: (e) => {
            const v = Number(e.target.value);
            fx.setPitch(v);
            pitchVal.textContent = (v > 0 ? '+' : '') + v + ' ст · ×' + Math.pow(2, v / 12).toFixed(2);
          },
        });
        const pitchVal = el('span', { class: 'small', text: '0 ст · ×1.00' });
        const loopBox = el('label', { class: 'small', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
          el('input', { type: 'checkbox', onchange: (e) => fx.setPlayerLoop(e.target.checked) }),
          el('span', { text: 'зациклить' }),
        ]);
        playerCard.appendChild(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn mini', text: '▶ Играть',
            onclick: () => fx.playSample(Math.pow(2, Number(pitch.value) / 12), loopBox.querySelector('input').checked),
          }),
          el('button', { class: 'btn ghost mini', text: '■ Стоп', onclick: () => fx.stopSample() }),
          loopBox,
        ]));
        playerCard.appendChild(el('div', { class: 'row' }, [el('label', { class: 'hint', text: 'Pitch' }), pitch, pitchVal]));
        playerCard.appendChild(el('p', { class: 'muted', text: 'Плеер идёт в тот же процессор: выбирай программу и веди X-Y — получится эффект поверх твоего WAV/MP3 (pitch adjust у miniKP2 работает так же).' }));
      }
    };
    rebuildPlayer();

    wrap.appendChild(head2);
    wrap.appendChild(el('div', { class: 'kaoss-body fx-body' }, [
      el('div', { class: 'fx-progs' }, [progGrid]),
      el('div', { class: 'kaoss-side' }, [
        pad,
        el('div', { class: 'hint', text: 'X/Y меняют параметры выбранной программы. Винил-брейк, гейт, эхо, реверб — как в miniKP2.' }),
      ]),
      playerCard,
    ]));
    return wrap;
  };

  /* Перенос фразы лупа в паттерн выбранной машины (или в новую машину) */
  KU.loopToProject = function (inst, slot) {
    const MS = window.MS;
    const segs = inst.loops[slot] || [];
    const song = MS.song;
    const targets = song.tracks.filter((t) => t.engine !== 'beatbox');

    const box = el('div', {});
    box.appendChild(el('p', { class: 'muted', text: 'Фраза (' + segs.length + ' сегм.) станет нотами в паттерне выбранной машины. Такт = длина лупа (' + inst.loopBars + ' такт(а) при ' + inst.bpm + ' BPM).' }));

    const sel = el('select', { class: 'preset-select' }, targets.map((t, i) =>
      el('option', { value: String(song.tracks.indexOf(t)), text: t.name + ' · ' + window.ENGINES[t.engine].name })));
    box.appendChild(el('div', { class: 'row' }, [el('label', { class: 'hint', text: 'Куда' }), sel]));

    const modeSel = el('select', { class: 'preset-select' }, [
      el('option', { value: 'replace', text: 'Заменить паттерн' }),
      el('option', { value: 'merge', text: 'Добавить к нотам' }),
    ]);
    box.appendChild(el('div', { class: 'row' }, [el('label', { class: 'hint', text: 'Режим' }), modeSel]));

    const slotSel = el('select', { class: 'preset-select' }, [0, 1, 2, 3].map((i) =>
      el('option', { value: String(i), text: 'Паттерн ' + 'ABCD'[i] })));
    box.appendChild(el('div', { class: 'row' }, [el('label', { class: 'hint', text: 'В паттерн' }), slotSel]));

    const actions = [
      { label: 'Отмена' },
      {
        label: 'Перенести', primary: true,
        action: () => {
          const idx = Number(sel.value);
          const tr = song.tracks[idx];
          if (!tr) return;
          const patIdx = Number(slotSel.value);
          const notes = window.Kaoss.loopToNotes(segs, {
            bpm: inst.bpm,
            stepsPerBar: song.steps,
            bars: inst.loopBars,
          });
          const pat = window.Pattern.pattern(tr, patIdx);
          if (modeSel.value === 'replace') pat.notes = notes;
          else {
            notes.forEach((n) => {
              if (!pat.notes.some((x) => x.at === n.at && x.m === n.m)) pat.notes.push(n);
            });
          }
          window.Pattern.markUsed(tr);
          tr.patIndex = patIdx;
          MS.state.activeTrack = idx;
          MS.renderAll();
          window.UI.toast('Перенесено ' + notes.length + ' нот в «' + tr.name + '» · паттерн ' + 'ABCD'[patIdx], 'ok');
        },
      },
    ];
    UI.modal('Луп → паттерн', box, actions);
  };

  const SCALE_NAMES = {
    major: 'Мажор', minor: 'Минор', penta: 'Пентатоника', pentaMin: 'Мин. пента',
    blues: 'Блюз', dorian: 'Дорийский', phrygian: 'Фригийский', chromatic: 'Хроматика',
  };

  function noteName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  KU.SCALE_NAMES = SCALE_NAMES;
  window.KaossUI = KU;
})();
