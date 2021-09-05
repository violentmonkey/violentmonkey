import options from '../../options';
import './style.css';

let style;
let styleTheme;
const THEME_KEY = 'editorTheme';
const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css, elem) => {
  if (css && !elem) {
    elem = document.createElement('style');
    document.documentElement.appendChild(elem);
  }
  if (css || elem) {
    css = css || '';
    elem.textContent = css;
    try {
      localStorage.setItem(CACHE_KEY, css);
    } catch {
      // ignore
    }
  }
  return elem;
};

const setTheme = (css) => {
  if (!global.location.pathname.startsWith('/popup')) {
    styleTheme = setStyle(css ?? options.get(THEME_KEY), styleTheme);
  }
};

// In some versions of Firefox, `localStorage` is not allowed to be accessed
// in Private Browsing mode.
try {
  setStyle(localStorage.getItem(CACHE_KEY));
} catch {
  // ignore
}

options.ready.then(setTheme);
options.hook((changes) => {
  let v;
  if ((v = changes[THEME_KEY]) != null) {
    setTheme(v);
  }
  if ((v = changes.customCSS) != null) {
    style = setStyle(v, style);
  }
});
