/* Данные паттернов и пиано-ролл.
   Ноты хранятся объектами { m: midi, len: шаги, v: velocity } — это позволяет
   тянуть ноту по высоте, менять её длину и громкость прямо в сетке. */
(function () {
  'use strict';

  const P = {};
  const el = window.UI.el;

  // ---------- модель ----------
  P.notelen = (n) => (n.len != null ? n.len : 1);
  P.noteend = (n) => n.at + P.notelen(n);
  P.fits = (track, n, ignore) => n.at + P.notelen(n) <= track.patLen;

  /* Приводит любой формат к списку объектов.
     Новый формат — плоский список {at,m,len,v};
     старый — массив шагов, где в шаге лежит midi или массив midi. */
  P.normalizeNotes = function (list, patLen) {
    const out = [];
    if (!Array.isArray(list)) return out;
    const push = (at, m, len, v) => {
      const at2 = Math.max(0, Math.min(at, patLen - 1));
      out.push({ at: at2, m, len: Math.max(1, Math.min(len || 1, patLen - at2)), v: v != null ? v : 0.85 });
    };
    list.forEach((item, step) => {
      if (item == null) return;
      if (typeof item === 'number') push(step, item, 1, 0.85);
      else if (Array.isArray(item)) item.forEach((x) => { if (typeof x === 'number') push(step, x, 1, 0.85); });
      else if (item.m != null) push(item.at != null ? item.at : step, item.m, item.len, item.v);
    });
    return out;
  };

  P.normalizePads = function (list, patLen) {
    const out = [];
    if (!Array.isArray(list)) return out;
    const push = (at, p) => out.push({ at: Math.max(0, Math.min(at, patLen - 1)), p });
    list.forEach((item, step) => {
      if (item == null) return;
      if (typeof item === 'number') push(step, item);
      else if (Array.isArray(item)) item.forEach((p) => push(step, p));
      else if (item.p != null) push(item.at != null ? item.at : step, item.p);
    });
    return out;
  };

  P.ensureTrack = function (t) {
    if (!t.bank) t.bank = [];          // 4 паттерна (A/B/C/D)
    for (let i = 0; i < 4; i++) {
      if (!t.bank[i] || typeof t.bank[i] !== 'object') t.bank[i] = {};
      const b = t.bank[i];
      if (!Array.isArray(b.notes)) b.notes = [];
      if (!Array.isArray(b.pads)) b.pads = [];
    }
    if (t.patIndex == null) t.patIndex = 0;
    if (t.scenes == null) t.scenes = 'A';
    if (!Array.isArray(t.used)) t.used = [0];
    if (!t.used.length) t.used.push(0);
    return t;
  };

  P.pattern = function (t, idx) {
    P.ensureTrack(t);
    return t.bank[idx != null ? idx : t.patIndex];
  };
  P.copyPattern = (t, from, to) => {
    P.ensureTrack(t);
    t.bank[to] = JSON.parse(JSON.stringify(t.bank[from]));
    return t.bank[to];
  };
  P.clear = function (t) {
    const p = P.pattern(t);
    p.notes = [];
    p.pads = [];
    return p;
  };
  P.markUsed = function (t) {
    P.ensureTrack(t);
    if (t.used.indexOf(t.patIndex) < 0) t.used.push(t.patIndex);
    t.used.sort();
  };
  P.removeUsed = function (t) {
    P.ensureTrack(t);
    t.used = t.used.filter((i) => i !== t.patIndex);
    if (!t.used.length) t.used.push(t.patIndex);
  };

  /* Составные ноты (длиной >1) → список событий [step, midi, durationSteps, velocity] */
  P.events = function (t) {
    const p = P.pattern(t);
    return p.notes.map((n) => [n.at, n.m, Math.max(1, P.notelen(n)), n.v != null ? n.v : 0.85]);
  };

  // ---------- пиано-ролл ----------
  const CELL_H = 15;
  const CELL_W = 24;
  const ROLL_LO = 24;
  const ROLL_HI = 96;

  let drag = null;
  const mounts = [];   // {host, track, opts}

  const isBlack = (m) => [1, 3, 6, 8, 10].indexOf(m % 12) >= 0;

  P.render = function (track, opts) {
    opts = opts || {};
    const grid = opts.grid !== false;
    const root = el('div', { class: 'roll' + (grid ? ' with-grid' : '') });
    const inner = el('div', { class: 'roll-inner' });
    P.ensureTrack(track);
    const pat = P.pattern(track);
    const total = track.patLen;
    const accent = (window.ENGINES[track.engine] || {}).accent || '#4ee1c1';

    const head = el('div', { class: 'roll-ruler' }, [
      el('div', { class: 'roll-key', text: '' }),
    ]);
    for (let s = 0; s < total; s++) {
      head.appendChild(el('div', {
        class: 'ruler-cell' + (s % 4 === 0 ? ' beat' : '') + (s % 16 === 0 ? ' bar' : ''),
        style: { width: CELL_W + 'px' },
        text: s % 4 === 0 ? String(s / 4 + 1) : '',
      }));
    }
    inner.appendChild(head);

    const rows = el('div', { class: 'roll-rows', style: { height: (ROLL_HI - ROLL_LO + 1) * CELL_H + 'px' } });

    // горизонтальная сетка и подписи клавиш
    for (let m = ROLL_HI; m >= ROLL_LO; m--) {
      const row = el('div', {
        class: 'roll-row' + (isBlack(m) ? ' blackrow' : ''),
        style: { height: CELL_H + 'px', top: (ROLL_HI - m) * CELL_H + 'px' },
      });
      row.appendChild(el('div', { class: 'roll-key' + (isBlack(m) ? ' blackkey' : ''), text: noteName(m) }));
      for (let s = 0; s < total; s++) {
        row.appendChild(el('div', {
          class: 'roll-cell' + (s % 4 === 0 ? ' beat' : '') + (s % 16 === 0 ? ' bar' : ''),
          style: { width: CELL_W + 'px' },
          'data-step': s,
        }));
      }
      rows.appendChild(row);
    }

    // слой нот
    const layer = el('div', {
      class: 'note-layer',
      style: {
        left: '46px', right: '0', top: '22px',
        height: (ROLL_HI - ROLL_LO + 1) * CELL_H + 'px',
      },
      onpointerdown: (e) => {
        if (e.target !== layer) return;
        e.preventDefault();
        const r = layer.getBoundingClientRect();
        const step = Math.floor((e.clientX - r.left) / CELL_W);
        const midi = ROLL_HI - Math.floor((e.clientY - r.top) / CELL_H);
        if (step < 0 || step >= total) return;
        addNote(track, midi, step, accent, opts);
      },
    });

    pat.notes.forEach((n, idx) => {
      const top = (ROLL_HI - n.m) * CELL_H;
      const len = P.notelen(n);
      const note = el('div', {
        class: 'note' + (n.m < 0 ? '' : ''),
        style: {
          left: n.at * CELL_W + 1 + 'px',
          top: top + 1 + 'px',
          width: len * CELL_W - 2 + 'px',
          height: CELL_H - 2 + 'px',
          background: 'linear-gradient(180deg,' + accent + ',' + shade(accent, -28) + ')',
          opacity: 0.5 + 0.5 * (n.v != null ? n.v : 0.85),
        },
      }, [el('div', { class: 'note-grip' })]);

      note.dataset.idx = idx;
      note.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = e.target.classList.contains('note-grip') ? 'resize' : 'move';
        drag = {
          mode, idx, track,
          startX: e.clientX, startY: e.clientY,
          at0: n.at, m0: n.m, len0: len,
          el: note,
        };
        note.classList.add('dragging');
        try { note.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      });
      note.addEventListener('pointermove', (e) => {
        if (!drag || drag.el !== note) return;
        const dStep = Math.round((e.clientX - drag.startX) / CELL_W);
        const dRow = Math.round((e.clientY - drag.startY) / CELL_H);
        const n2 = pat.notes[drag.idx];
        if (!n2) return;
        if (drag.mode === 'move') {
          n2.at = clamp(drag.at0 + dStep, 0, total - P.notelen(n2));
          n2.m = clamp(drag.m0 - dRow, ROLL_LO, ROLL_HI);
          note.style.left = n2.at * CELL_W + 1 + 'px';
          note.style.top = (ROLL_HI - n2.m) * CELL_H + 1 + 'px';
        } else {
          n2.len = clamp(drag.len0 + dStep, 1, total - n2.at);
          note.style.width = P.notelen(n2) * CELL_W - 2 + 'px';
        }
      });
      const finish = () => {
        if (!drag || drag.el !== note) return;
        note.classList.remove('dragging');
        drag = null;
        P.markUsed(track);
        if (opts.onChange) opts.onChange(track);
      };
      note.addEventListener('pointerup', finish);
      note.addEventListener('pointercancel', finish);
      note.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        pat.notes.splice(idx, 1);
        P.markUsed(track);
        P.refresh(track);
      });

      // точка velocity
      const vel = el('div', {
        class: 'note-vel',
        title: 'Громкость ' + Math.round((n.v || 0.85) * 100) + '%',
        onpointerdown: (e) => {
          e.preventDefault(); e.stopPropagation();
          drag = { mode: 'vel', idx, track, startY: e.clientY, v0: n.v || 0.85, el: note };
        },
        onpointermove: (e) => {
          if (!drag || drag.el !== note) return;
          const n2 = pat.notes[drag.idx];
          if (!n2) return;
          n2.v = clamp(drag.v0 + (drag.startY - e.clientY) / 100, 0.05, 1);
          note.style.opacity = 0.5 + 0.5 * n2.v;
        },
        onpointerup: () => { if (drag && drag.el === note) { drag = null; if (opts.onChange) opts.onChange(track); } },
      });
      note.appendChild(vel);

      layer.appendChild(note);
    });

    const scroller = el('div', { class: 'roll-scroll' }, [el('div', { class: 'roll-stage', style: { width: 46 + total * CELL_W + 'px' } }, [rows, layer])]);
    inner.appendChild(scroller);
    root.appendChild(inner);
    return root;
  };

  function addNote(track, midi, step, accent, opts) {
    const pat = P.pattern(track);
    const n = { at: step, m: midi, len: Math.min(4, Math.max(1, track.patLen - step)), v: 0.85 };
    pat.notes.push(n);
    P.markUsed(track);
    if (opts.onPreview) opts.onPreview(midi, n.v);
    P.refresh(track);
  }

  /* Монтирует ролл в контейнер и запоминает его для перерисовки.
     На один контейнер — ровно один ролл. */
  P.mount = function (host, track, opts) {
    opts = opts || {};
    let rec = null;
    for (let i = 0; i < mounts.length; i++) if (mounts[i].host === host) { rec = mounts[i]; break; }
    if (!rec) { rec = { host }; mounts.push(rec); }
    rec.track = track;
    rec.opts = opts;

    const save = host.__scroll;
    const root = P.render(track, opts);
    if (rec.root && rec.root.parentNode === host) host.replaceChild(root, rec.root);
    else { host.innerHTML = ''; host.appendChild(root); }
    rec.root = root;

    const sc = root.querySelector('.roll-scroll');
    if (sc) {
      if (save) { sc.scrollLeft = save.left; sc.scrollTop = save.top; }
      else {
        const pat = P.pattern(track);
        const ms = pat.notes.map((n) => n.m);
        const center = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 60;
        sc.scrollTop = Math.max(0, (ROLL_HI - center) * CELL_H - 80);
      }
      sc.addEventListener('scroll', () => { host.__scroll = { left: sc.scrollLeft, top: sc.scrollTop }; });
    }
    return root;
  };

  /* Перерисовывает все роллы указанной дорожки (или все) */
  P.refresh = function (track) {
    for (let i = mounts.length - 1; i >= 0; i--) {
      const m = mounts[i];
      if (!m.host.isConnected || !m.root || m.root.parentNode !== m.host) { mounts.splice(i, 1); continue; }
      if (!track || m.track === track) {
        const sc = m.host.querySelector('.roll-scroll');
        m.host.__scroll = sc ? { left: sc.scrollLeft, top: sc.scrollTop } : m.host.__scroll;
        P.mount(m.host, m.track, m.opts);
      }
    }
  };

  P.refreshAfterEdit = function (track, opts) {
    if (opts && opts.onChange) opts.onChange(track);
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function shade(hex, amt) {
    const h = hex.replace('#', '');
    const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    let r = (num >> 16) + amt, g = ((num >> 8) & 255) + amt, b = (num & 255) + amt;
    r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function noteName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  P.noteName = noteName;
  P.CELL_H = CELL_H;
  P.CELL_W = CELL_W;
  P.ROLL_LO = ROLL_LO;
  P.ROLL_HI = ROLL_HI;

  window.Pattern = P;
})();
