/* Mini Studio — тач-слой: жесты, крупные зоны касания, вибро-отдача.
   Работает поверх обычных pointer-событий, поэтому мышь и перо не ломаются. */
(function () {
  'use strict';

  const T = {};
  T.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  /* Вибро-отклик: короткий тик на нажатия кнопок (если поддерживается) */
  T.haptic = function (ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (e) { /* не критично */ }
  };

  /* Убираем «резинку» страницы и случайные зум/выделения на пэдах,
     но НЕ запрещаем скролл там, где он нужен. */
  T.init = function () {
    if (document.body.dataset.touchInit) return;
    document.body.dataset.touchInit = '1';
    const root = document.documentElement;
    root.classList.toggle('touch', !!T.isTouch);
    root.classList.toggle('mouse', !T.isTouch);

    // двойной тап по кнопкам не должен зумить
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      const target = e.target.closest('button, .btn, .tab, .xy-pad, .knob, .pad, .step, .fx-pad, .dev-prog');
      if (target && now - lastTap < 320 && e.cancelable) e.preventDefault();
      lastTap = now;
    }, { passive: false });

    // контекстное меню долгого тапа только на игровых поверхностях
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.xy-pad, .knob, .rng, .dev-range, .pad, .step')) e.preventDefault();
    });

    // тактильная отдача на нажатия музыкальных элементов
    document.addEventListener('pointerdown', (e) => {
      const hit = e.target.closest('.xy-pad, .pad, .step, .fx-pad, .dev-prog, .clipblock, .key, .knob');
      if (hit) T.haptic(6);
    }, { passive: true });
  };

  /* Экранная блокировка ориентации «пэд-режим»: кнопка в топбаре.
     На телефоне при игре по X-Y удобнее горизонталь. */
  T.toggleFullscreen = function () {
    const d = document;
    const el = d.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!d.fullscreenElement && req) {
      req.call(el).catch(() => {});
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else if (d.exitFullscreen) {
      d.exitFullscreen().catch(() => {});
    }
  };

  /* Мягкая «клавиатура пэда»: на телефоне X-Y пэд ловит мультитач —
     вторая точка не тянет первую (у каждой свой pointerId). */
  T.padMultiTouch = function (root) {
    if (!root || root.dataset.mt) return root;
    root.dataset.mt = '1';
    root.style.touchAction = 'none';
    return root;
  };

  /* Скролл сетки одним пальцем на тач-устройствах:
     в редакторах сетку двигаем пальцем, а не колёсиком. */
  T.enableDragScroll = function (node) {
    if (!node || !T.isTouch || node.dataset.dragScroll) return;
    node.dataset.dragScroll = '1';
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, active = false, moved = false;
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('input, select, button')) return;
      active = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      startLeft = node.scrollLeft; startTop = node.scrollTop;
    }, { passive: true });
    node.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // жест «сдвинуть», а не «нажать»: перетаскивание начинается при явном
      // горизонтальном уводе пальца (вертикальный скролл страницы не трогаем)
      if (!moved) {
        if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 12) return;
        moved = true;
        // тап по ячейке сетки уже мог сработать на pointerdown — отменяем его,
        // иначе прокрутка заодно включала/выключала ноту (было так на телефоне)
        if (node.__cancelTap) node.__cancelTap();
      }
      node.classList.add('panning');
      if (node.scrollWidth > node.clientWidth) node.scrollLeft = startLeft - dx;
      if (node.scrollHeight > node.clientHeight) node.scrollTop = startTop - dy;
    }, { passive: true });
    const end = () => { active = false; moved = false; node.classList.remove('panning'); };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('pointerleave', end);
  };

  window.TouchUI = T;
})();
