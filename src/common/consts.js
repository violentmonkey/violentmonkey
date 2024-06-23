// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

export const CHARSET_UTF8 = 'charset=UTF-8';
export const FORM_URLENCODED = 'application/x-www-form-urlencoded';
export const INFERRED = 'inferred';
export const HOMEPAGE_URL = 'homepageURL';
export const SUPPORT_URL = 'supportURL';

// Allow metadata lines to start with WHITESPACE? '//' SPACE
// Allow anything to follow the predefined text of the metaStart/End
// The SPACE must be on the same line and specifically \x20 as \s would also match \r\n\t
// Note: when there's no valid metablock, an empty string is matched for convenience
export const USERSCRIPT_META_INTRO = '// ==UserScript==';
export const METABLOCK_RE = /((?:^|\n)\s*\/\/\x20==UserScript==)([\s\S]*?\n)\s*\/\/\x20==\/UserScript==|$/;
export const META_STR = 'metaStr';
export const NEWLINE_END_RE = /\n((?!\n)\s)*$/;
export const WATCH_STORAGE = 'watchStorage';
// `browser` is a local variable since we remove the global `chrome` and `browser` in injected*
// to prevent exposing them to userscripts with `@inject-into content`
export const browser = process.env.IS_INJECTED !== 'injected-web' && global.browser;

// setTimeout truncates the delay to a 32-bit signed integer so the max delay is ~24 days
export const TIMEOUT_MAX = 0x7FFF_FFFF;
export const TIMEOUT_HOUR = 60 * 60 * 1000;
export const TIMEOUT_24HOURS = 24 * 60 * 60 * 1000;
export const TIMEOUT_WEEK = 7 * 24 * 60 * 60 * 1000;

export const BLACKLIST = 'blacklist';
export const BLACKLIST_ERRORS = `${BLACKLIST}Errors`;
export const RUN_AT_RE = /^document-(start|body|end|idle)$/;
export const KNOWN_INJECT_INTO = {
  // Using the default injection order: auto, page, content
  [AUTO]: 1,
  [PAGE]: 1,
  [CONTENT]: 1,
};
export const NO_CACHE = { cache: 'no-cache' };
export const __CODE = /*@__PURE__*/Symbol('code'); // not enumerable and stripped when serializing
export const UA_PROPS = ['userAgent', 'brands', 'mobile', 'platform'];
export const TL_AWAIT = 'topLevelAwait';
export const UNWRAP = 'unwrap';
