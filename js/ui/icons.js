// Minimal line icon set (24x24 viewBox, stroked).
const P = {
  presets: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  body: '<circle cx="12" cy="4.5" r="2.2"/><path d="M8 21l1.5-7-3-5.5h11l-3 5.5L16 21M12 14v-5"/>',
  shape: '<path d="M8 3c0 4-2 5-2 9s2 5 2 9M16 3c0 4 2 5 2 9s-2 5-2 9M9 12h6"/>',
  limbs: '<path d="M7 3l2 7-3 4 1 7M17 3l-2 7 3 4-1 7M9 10h6"/>',
  bones: '<path d="M7.5 6.5a2 2 0 1 0-2.8-2.8 2 2 0 0 0-1.4 3.4 2 2 0 0 0 3.4 1.4l9.8 9.8a2 2 0 0 0 1.4 3.4 2 2 0 0 0 2.8-2.8 2 2 0 0 0 1.4-3.4 2 2 0 0 0-3.4-1.4z"/>',
  head: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.5 5 3 6.5V21h6v-2h2a2 2 0 0 0 2-2v-2.5l1.5-.5-1.5-3A7 7 0 0 0 12 3z"/>',
  face: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M12 11v3M9.5 16.5c1.5 1 3.5 1 5 0"/>',
  expr: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5c2 2.5 6 2.5 8 0M8.5 9.5l1.5.8M15.5 9.5l-1.5.8"/>',
  skin: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/><path d="M10 15a2 2 0 0 0 2 2"/>',
  makeup: '<path d="M9 21h6M10 21V11h4v10M10.5 11l1-6c.2-1 .8-1 1 0l1 6"/>',
  eyes: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hair: '<path d="M5 20c-1-6 0-12 7-15 7 3 8 9 7 15M8 20c0-5 1-9 4-12M16 20c0-5-1-9-4-12"/>',
  beard: '<path d="M5 8c0 7 3 12 7 12s7-5 7-12M8 14c2.5 1.5 5.5 1.5 8 0M9 4h6"/>',
  clothes: '<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/>',
  scene: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3"/><circle cx="16" cy="16" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="16" cy="8" r="1.3"/><circle cx="8" cy="16" r="1.3"/>',
  sym: '<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>',
  infinity: '<path d="M18.2 8.5c-2.4 0-4 3.5-6.2 3.5S8.2 8.5 5.8 8.5a3.5 3.5 0 0 0 0 7c2.4 0 4-3.5 6.2-3.5s3.8 3.5 6.2 3.5a3.5 3.5 0 0 0 0-7z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  load: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
  hide: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-2.7 3.4M6.3 6.3C3.6 8.1 2 12 2 12s3.6 6 10 6c1.5 0 2.9-.3 4.1-.9"/>',
  show: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  spin: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}
