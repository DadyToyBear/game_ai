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

  /* ---------- Kaossilator ---------- */
  KU.instrumentPanel = function (inst, onLayoutChange) {
    const wrap = el('div', { class: 'kaoss' });

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
        inst.noteOff();
        pad.classList.remove('active');
      },
    });

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

      loopBox.appendChild(el('div', { class: 'loop-row' }, [
        el('span', { class: 'loop-num', text: 'LOOP ' + (slot + 1) }),
        rec, play, clr, state,
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

    wrap.appendChild(head);
    wrap.appendChild(el('div', { class: 'kaoss-body' }, [side]));
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
      onUp: () => { pad.classList.remove('active'); },
    });

    const head = el('div', { class: 'kaoss-head' }, [
      el('div', { class: 'kaoss-title' }, [
        el('span', { class: 'kaoss-badge fx', text: 'FX' }),
        el('div', {}, [
          el('div', { class: 'machine-title', text: 'mini Kaoss Pad 2 — Dynamic FX Processor' }),
          el('div', { class: 'machine-desc', text: 'Процессор на мастер-шине: 12 программ, управление X-Y как на железе.' }),
        ]),
      ]),
      el('div', { class: 'spacer' }),
      nameEl, tagEl,
      el('button', { class: 'btn ghost mini', text: 'Сброс', onclick: () => { fx.reset(); pad.setXY(0.5, 0.5); pad.classList.remove('active'); } }),
    ]);

    wrap.appendChild(head);
    wrap.appendChild(el('div', { class: 'kaoss-body fx-body' }, [
      el('div', { class: 'fx-progs' }, [progGrid]),
      el('div', { class: 'kaoss-side' }, [
        pad,
        el('div', { class: 'hint', text: 'X/Y меняют параметры выбранной программы. Винил-брейк, гейт, эхо, реверб — как в miniKP2.' }),
      ]),
    ]));
    return wrap;
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
