import ua from '#/common/ua';

export const isHiDPI = matchMedia('screen and (min-resolution: 144dpi)').matches;

if (ua.isFirefox) { // Firefox doesn't show favicon
  const icons = browser.runtime.getManifest().browser_action.default_icon;
  const el = document.createElement('link');
  el.rel = 'icon';
  el.href = icons[isHiDPI ? 32 : 16];
  document.head.appendChild(el);
}
