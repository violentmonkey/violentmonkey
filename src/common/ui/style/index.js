import Vue from 'vue';
import { i18n } from '@/common';
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

style = setStyle(localStorage[CACHE_KEY] || '');

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
    style = setStyle(v, style);
    if (v && localStorage[CACHE_KEY] !== v) {
      localStorage[CACHE_KEY] = v;
    } else if (!v && CACHE_KEY in localStorage) {
      delete localStorage[CACHE_KEY];
    }
  }
});

Vue.prototype.i18n = i18n;
/** @returns {?number} Number of lines + 1 if the last line is not empty */
Vue.prototype.CalcRows = val => val && (
  val.match(/$/gm).length
  + !val.endsWith('\n')
);

if ('ontouchstart' in document) {
  document.documentElement.classList.add('touch');
}
