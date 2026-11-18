const shapes = {
  'arrow-right': '<path d="M3 12h17m-7-7 7 7-7 7"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16m10-16v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  file: '<path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z"/><path d="M13 3v6h6m-10 4h6m-6 4h4"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5m-9 5v10"/>',
  target: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/><circle cx="12" cy="12" r="3.3"/>',
  maximize: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  minimize: '<path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>',
  play: '<path d="m8 5 12 7-12 7V5Z" fill="currentColor"/>',
  pause: '<path d="M9 6v12m6-12v12" stroke-width="2.6"/>',
  restart: '<path d="M3.5 12a8.5 8.5 0 1 1 2.5 6M3.5 6.5V12H9"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15m-14 16-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  scissors: '<circle cx="5" cy="5" r="2.6"/><circle cx="5" cy="19" r="2.6"/><path d="m7 7 14 14M7 17 21 3M12 12l-2-2"/>',
  checker: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M4 4h5v5H4zm5 5h6v6H9zm6 6h5v5h-5zm0-11h5v5h-5zM4 15h5v5H4z" fill="currentColor" stroke="none" opacity=".74"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? ''}</svg>`;
}
