/* Explicit, in-memory dashboard connection; no bridge token crosses origins. */
(() => {
  const $ = id => document.getElementById(id);
  let dashboardURL = '';
  function safeDashboard(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('Введите полный HTTPS-адрес дашборда.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username || url.password || url.origin === location.origin || url.hash) {
      throw new Error('Нужен доверенный HTTPS-адрес другого сервера без логина и фрагмента (HTTP только на localhost).');
    }
    if (location.protocol === 'https:' && url.protocol !== 'https:') {
      throw new Error('HTTPS-страница не может встроить HTTP-дашборд.');
    }
    return url.href;
  }
  $('load-dashboard').onclick = () => {
    try {
      const next = safeDashboard($('dashboard-url').value);
      dashboardURL = next;
      $('dashboard-url').value = '';
      $('dashboard').src = next;
      $('open-dashboard').disabled = false;
      $('close-dashboard').disabled = false;
      $('dashboard-status').textContent = 'Дашборд запрошен. Если он не открывается, попробуйте отдельную вкладку.';
    } catch (error) {
      dashboardURL = ''; $('dashboard').src = 'about:blank';
      $('open-dashboard').disabled = true; $('close-dashboard').disabled = true;
      $('dashboard-status').textContent = error.message;
    }
  };
  $('open-dashboard').onclick = () => {
    if (dashboardURL) window.open(dashboardURL, '_blank', 'noopener,noreferrer');
  };
  $('close-dashboard').onclick = () => {
    $('dashboard').src = 'about:blank'; dashboardURL = ''; $('dashboard-url').value = '';
    $('open-dashboard').disabled = true; $('close-dashboard').disabled = true;
    $('dashboard-status').textContent = 'Дашборд закрыт. Адрес удалён из этой страницы; удалённые cookie и вкладки не изменены.';
  };
})();
