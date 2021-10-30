// SAFETY WARNING! Exports used by `injected` must make ::safe() calls

export const INJECT_AUTO = 'auto';
export const INJECT_PAGE = 'page';
export const INJECT_CONTENT = 'content';

export const INJECT_MAPPING = {
  __proto__: null,
  // `auto` tries to provide `window` from the real page as `unsafeWindow`
  [INJECT_AUTO]: [INJECT_PAGE, INJECT_CONTENT],
  // inject into page context
  [INJECT_PAGE]: [INJECT_PAGE],
  // inject into content context only
  [INJECT_CONTENT]: [INJECT_CONTENT],
};

export const CMD_SCRIPT_ADD = 'AddScript';
export const CMD_SCRIPT_UPDATE = 'UpdateScript';

// Allow metadata lines to start with WHITESPACE? '//' SPACE
// Allow anything to follow the predefined text of the metaStart/End
// The SPACE must be on the same line and specifically \x20 as \s would also match \r\n\t
// Note: when there's no valid metablock, an empty string is matched for convenience
export const METABLOCK_RE = /(?:^|\n)\s*\/\/\x20==UserScript==([\s\S]*?\n)\s*\/\/\x20==\/UserScript==|$/;

export const INJECTABLE_TAB_URL_RE = /^(https?|file|ftps?):/;

// `browser` is a local variable since we remove the global `chrome` and `browser` in injected*
// to prevent exposing them to userscripts with `@inject-into content`
export const { browser } = global;

// setTimeout truncates the delay to a 32-bit signed integer so the max delay is ~24 days
export const TIMEOUT_MAX = 0x7FFF_FFFF;
export const TIMEOUT_HOUR = 60 * 60 * 1000;
export const TIMEOUT_24HOURS = 24 * 60 * 60 * 1000;
export const TIMEOUT_WEEK = 7 * 24 * 60 * 60 * 1000;
