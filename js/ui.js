/* Мелкие UI-хелперы: создание элементов, ручки-кнобы, тосты, модальные окна */
(function () {
  'use strict';

  const UI = {};

  UI.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  UI.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  UI.fmt = function (v, p) {
    if (p.unit === 'Гц' && v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' кГц';
    if (p.unit === 'с') return v < 1 ? (v * 1000).toFixed(0) + ' мс' : v.toFixed(2) + ' с';
    const dec = p.step >= 1 ? 0 : (p.step >= 0.1 ? 1 : 2);
    return Number(v).toFixed(dec) + (p.unit ? ' ' + p.unit : '');
  };

  function norm(p, v) {
    if (p.log) {
      const a = Math.log(p.min), b = Math.log(p.max);
      return (Math.log(Math.max(p.min, v)) - a) / (b - a);
    }
    return (v - p.min) / (p.max - p.min);
  }
  function denorm(p, n) {
    n = UI.clamp(n, 0, 1);
    if (p.log) {
      const a = Math.log(p.min), b = Math.log(p.max);
      return Math.exp(a + n * (b - a));
    }
    return p.min + n * (p.max - p.min);
  }
  function quant(p, v) {
    const st = p.step || 0.01;
    return UI.clamp(Math.round(v / st) * st, p.min, p.max);
  }

  /* Ручка. Возвращает элемент с методами set/get. */
  UI.knob = function (p, value, onChange) {
    const size = 46;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'knob-svg');
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '40');
    track.setAttribute('class', 'knob-track');
    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', '50'); arc.setAttribute('cy', '50'); arc.setAttribute('r', '40');
    arc.setAttribute('class', 'knob-arc');
    arc.setAttribute('transform', 'rotate(-215 50 50)');
    const circ = 2 * Math.PI * 40;
    track.setAttribute('stroke-dasharray', circ * 0.75 + ' ' + circ);
    svg.appendChild(track); svg.appendChild(arc);

    const valueEl = UI.el('span', { class: 'knob-value' });
    const labelEl = UI.el('span', { class: 'knob-label', text: p.label });
    const root = UI.el('div', { class: 'knob', style: { width: size + 'px' }, title: p.label }, [svg, valueEl, labelEl]);

    let cur = quant(p, value);
    let dragY = null;
    let dragN = 0;

    function paint() {
      const n = norm(p, cur);
      arc.setAttribute('stroke-dasharray', circ * 0.75 * n + ' ' + circ);
      valueEl.textContent = UI.fmt(cur, p);
      root.dataset.value = cur;
    }
    function set(v, silent) {
      cur = quant(p, v);
      paint();
      if (!silent && onChange) onChange(cur);
    }

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      dragY = e.clientY;
      dragN = norm(p, cur);
      root.classList.add('active');
    });
    root.addEventListener('pointermove', (e) => {
      if (dragY === null) return;
      const speed = e.shiftKey ? 0.0012 : 0.006;
      const n = UI.clamp(dragN + (dragY - e.clientY) * speed, 0, 1);
      set(denorm(p, n));
      dragN = n; dragY = e.clientY;
    });
    const end = () => { dragY = null; root.classList.remove('active'); };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', () => set(p.def));
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const n = UI.clamp(norm(p, cur) + (e.deltaY < 0 ? 0.02 : -0.02), 0, 1);
      set(denorm(p, n));
    }, { passive: false });

    paint();
    root.knob = { set: (v) => set(v, true), get: () => cur, param: p };
    return root;
  };

  UI.toast = function (msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = UI.el('div', { id: 'toasts' });
      document.body.appendChild(box);
    }
    const t = UI.el('div', { class: 'toast ' + (kind || ''), text: msg });
    box.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2600);
  };

  UI.modal = function (title, contentNode, actions) {
    const back = UI.el('div', { class: 'modal-back' });
    const box = UI.el('div', { class: 'modal' });
    const close = () => back.remove();
    box.appendChild(UI.el('div', { class: 'modal-head' }, [
      UI.el('h3', { text: title }),
      UI.el('button', { class: 'btn ghost', text: '✕', onclick: close }),
    ]));
    box.appendChild(UI.el('div', { class: 'modal-body' }, [contentNode]));
    if (actions && actions.length) {
      box.appendChild(UI.el('div', { class: 'modal-actions' }, actions.map((a) =>
        UI.el('button', { class: 'btn ' + (a.primary ? 'primary' : ''), text: a.label, onclick: () => { if (a.action) a.action(); if (a.close !== false) close(); } })
      )));
    }
    back.appendChild(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    return { close };
  };

  UI.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = UI.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  window.UI = UI;
})();
