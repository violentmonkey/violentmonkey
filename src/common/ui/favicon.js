export const isHiDPI = matchMedia('screen and (min-resolution: 144dpi)').matches;

if (IS_FIREFOX) { // Firefox doesn't show favicon
  const el = document.createElement('link');
  el.rel = 'icon';
  el.href = `${ICON_PREFIX}${isHiDPI ? 32 : 16}.png`;
  document.head.appendChild(el);
}
