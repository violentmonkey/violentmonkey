import options from '../../options';
import './style.css';

let style;
let styleTheme;
/** @type {CSSMediaRule[]} */
let darkMediaRules;
let localStorage = {};
/* Accessing `localStorage` in may throw in Private Browsing mode or if dom.storage is disabled.
 * Since it allows object-like access, we'll map it to a variable with a fallback to a dummy. */
try {
  (localStorage = global.localStorage || {}).foo; // eslint-disable-line babel/no-unused-expressions
} catch (e) {
  /* keep the dummy object */
}

const THEME_KEY = 'editorTheme';
const UI_THEME_KEY = 'uiTheme';
const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css, elem) => {
  if (css && !elem) {
    elem = document.createElement('style');
    document.documentElement.appendChild(elem);
  }
  if (css || elem) {
    css = css || '';
    if (elem.textContent !== css) {
      elem.textContent = css;
    }
    if (localStorage[CACHE_KEY] !== css) {
      localStorage[CACHE_KEY] = css;
    }
  }
  return elem;
};

const setCmTheme = (css) => {
  if (!global.location.pathname.startsWith('/popup')) {
    styleTheme = setStyle(css ?? options.get(THEME_KEY), styleTheme);
  }
};

const setUiTheme = theme => {
  const darkThemeCondition = '(prefers-color-scheme: dark)';
  const mediaText = theme === 'dark' && 'screen'
    || theme === 'light' && 'not all'
    || darkThemeCondition;
  if (!darkMediaRules) {
    darkMediaRules = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.conditionText?.includes(darkThemeCondition)) {
          darkMediaRules.push(rule);
        }
      }
    }
  }
  darkMediaRules.forEach(rule => { rule.media.mediaText = mediaText; });
};

setStyle(localStorage[CACHE_KEY]);

options.hook((changes) => {
  let v;
  if ((v = changes[THEME_KEY]) != null) {
    setCmTheme(v);
  }
  if ((v = changes[UI_THEME_KEY]) != null) {
    setUiTheme(v);
  }
  if ((v = changes.customCSS) != null) {
    style = setStyle(v, style);
  }
});
