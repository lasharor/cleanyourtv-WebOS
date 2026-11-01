var API = 'http://127.0.0.1:8765',
  CACHE_KEY = 'cytv.cache.v7',
  VERSION = '1.5.7';
var DEFAULTS = {
  dock: ['netflix', 'youtube.leanback.v4', 'amazon', 'com.disney.disneyplus-prod'],
  topbar: [
    { label: 'Inputs', icon: 'inputs', action: 'inputs' },
    { label: 'Live TV', icon: 'tv', action: 'live' },
    { label: 'Settings', icon: 'settings', app: 'com.palm.app.settings' },
  ],
};
var PRESETS = [
  { label: 'Inputs', icon: 'inputs', action: 'inputs' },
  { label: 'Settings', icon: 'settings', app: 'com.palm.app.settings' },
  { label: 'Live TV', icon: 'tv', action: 'live' },
  { label: 'TV', icon: 'tv', app: 'com.webos.app.livetv' },
  { label: 'Power off', icon: 'power', action: 'poweroff' },
];
var ICONS = {
  inputs: '<path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  hdmi: '<path d="M4 8h16v7l-3 3H7l-3-3z"/><path d="M9 11v3M12 11v3M15 11v3"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
};
function svg(name) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (ICONS[name] || ICONS.grid) +
    '</svg>'
  );
}
