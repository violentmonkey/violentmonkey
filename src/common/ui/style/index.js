import options from '../../options';
import './style.css';

let style;
const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css) => {
  if (css && !style) {
    style = document.createElement('style');
    document.head.appendChild(style);
  }
  if (css || style) {
    css = css || '';
    style.textContent = css;
    localStorage.setItem(CACHE_KEY, css);
  }
};

setStyle(localStorage.getItem(CACHE_KEY));

options.hook((changes) => {
  if ('customCSS' in changes) {
    const { customCSS } = changes;
    setStyle(customCSS);
  }
});
