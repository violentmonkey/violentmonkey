import { isTouch } from '..';
import options from '../../options';
import './style.css';

export let customCssElem;
let styleTheme;
/** @type {CSSMediaRule[]} */
let darkMediaRules;
let localStorage = {};
/* Accessing `localStorage` in may throw in Private Browsing mode or if dom.storage is disabled.
 * Since it allows object-like access, we'll map it to a variable with a fallback to a dummy. */
try {
  (localStorage = global.localStorage).getItem('foo');
} catch (e) {
  localStorage = {};
}

const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css, elem) => {
  if (css && !elem) {
    elem = document.createElement('style');
    document.documentElement.appendChild(elem);
  }
  if ((css || elem) && elem.textContent !== css) {
    elem.textContent = css;
  }
  return elem;
};

export const findStyleSheetRules = darkThemeCondition => {
  const res = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.conditionText?.includes(darkThemeCondition)) {
        res.push(rule);
      }
    }
  }
  return res;
};

const setUiTheme = theme => {
  const darkThemeCondition = '(prefers-color-scheme: dark)';
  const mediaText = theme === 'dark' && 'screen'
    || theme === 'light' && 'not all'
    || darkThemeCondition;
  if (!darkMediaRules) {
    darkMediaRules = findStyleSheetRules(darkThemeCondition);
  }
  darkMediaRules.forEach(rule => { rule.media.mediaText = mediaText; });
};

customCssElem = setStyle(localStorage[CACHE_KEY] || '');

options.hook((changes) => {
  let v;
  if ((v = changes.editorTheme) != null
  && !global.location.pathname.startsWith('/popup')) {
    styleTheme = setStyle(v, styleTheme);
  }
  if ((v = changes.uiTheme) != null) {
    setUiTheme(v);
  }
  if ((v = changes.customCSS) != null) {
    customCssElem = setStyle(v, customCssElem);
    if (v && localStorage[CACHE_KEY] !== v) {
      localStorage[CACHE_KEY] = v;
    } else if (!v && CACHE_KEY in localStorage) {
      delete localStorage[CACHE_KEY];
    }
  }
});

if (isTouch) {
  document.documentElement.classList.add('touch');
}
document.documentElement.lang = chrome.i18n.getUILanguage(); // enable CSS hyphenation
