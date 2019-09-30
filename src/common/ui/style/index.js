import options from '../../options';
import './style.css';

let style;
const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css) => {
  if (css && !style) {
    style = document.createElement('style');
    document.documentElement.appendChild(style);
  }
  if (css || style) {
    css = css || '';
    style.textContent = css;
    try {
      localStorage.setItem(CACHE_KEY, css);
    } catch {
      // ignore
    }
  }
};

// In some versions of Firefox, `localStorage` is not allowed to be accessed
// in Private Browsing mode.
try {
  setStyle(localStorage.getItem(CACHE_KEY));
} catch {
  // ignore
}

options.hook((changes) => {
  if ('customCSS' in changes) {
    const { customCSS } = changes;
    setStyle(customCSS);
  }
});
