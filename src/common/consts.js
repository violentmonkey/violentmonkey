export const INJECT_AUTO = 'auto';
export const INJECT_PAGE = 'page';
export const INJECT_CONTENT = 'content';

export const INJECT_INTERNAL_PAGE = 'page';
export const INJECT_INTERNAL_CONTENT = 'content';
export const INJECT_INTERNAL_WRAP = 'wrap';

export const INJECT_MAPPING = {
  // `auto` tries to provide `window` from the real page as `unsafeWindow`
  [INJECT_AUTO]: [INJECT_INTERNAL_PAGE, INJECT_INTERNAL_WRAP, INJECT_INTERNAL_CONTENT],
  // inject into page context, if failed, try `wrap` mode for Firefox
  [INJECT_PAGE]: [INJECT_INTERNAL_PAGE, INJECT_INTERNAL_WRAP],
  // inject into content context only
  [INJECT_CONTENT]: [INJECT_INTERNAL_CONTENT],
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
