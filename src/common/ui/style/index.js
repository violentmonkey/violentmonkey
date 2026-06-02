import { docElem, isTouch } from '..';
import options from '../../options';
import './style.css';

export let customCssElem;
let styleTheme;
/** @type {CSSMediaRule[]} */
let darkMediaRules;
let narrowMediaWidth;
let localStorage = {};
/* Accessing `localStorage` in may throw in Private Browsing mode or if dom.storage is disabled.
 * Since it allows object-like access, we'll map it to a variable with a fallback to a dummy. */
try {
  (localStorage = global.localStorage).getItem('foo');
} catch (e) {
  localStorage = {};
}

export const NARROW_WIDTH = 800;
export const mediaWidths = {};
export const onMediaWidth = (width, root, cb) => {
  let mq = mediaWidths[root && narrowMediaWidth || width];
  if (mq && root && width !== NARROW_WIDTH) {
    mq = mediaWidths[root && narrowMediaWidth || width] = mq.onchange = null;
  }
  if (!mq) {
    if (root) narrowMediaWidth = width;
    mq = matchMedia(`(max-width: ${width}px)`);
    (mq.onchange = ({matches}) => {
      if (root) docElem.classList.toggle('narrow', matches);
      if (cb) cb(matches, mq);
    })(mq);
  } else if (cb) {
    cb(mq.matches);
  }
};

const CACHE_KEY = 'cacheCustomCSS';

const setStyle = (css, elem) => {
  if (css && !elem) {
    elem = document.createElement('style');
    docElem.appendChild(elem);
  }
  if ((css || elem) && elem.textContent !== css) {
    elem.textContent = css;
  }
  return elem;
};

const findStyleSheetRules = darkThemeCondition => {
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

if (isTouch) docElem.classList.add('touch');
docElem.lang = chrome.i18n.getUILanguage(); // enable CSS hyphenation
onMediaWidth(NARROW_WIDTH, true);
