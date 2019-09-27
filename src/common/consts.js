export const INJECT_PAGE = 'page';
export const INJECT_CONTENT = 'content';
export const INJECT_AUTO = 'auto';

export const CMD_SCRIPT_ADD = 'AddScript';
export const CMD_SCRIPT_UPDATE = 'UpdateScript';

// Allow metadata lines to start with WHITESPACE? '//' SPACE
// Allow anything to follow the predefined text of the metaStart/End
// The SPACE must be on the same line and specifically \x20 as \s would also match \r\n\t
// Note: when there's no valid metablock, an empty string is matched for convenience
export const METABLOCK_RE = /(?:^|\n)\s*\/\/\x20==UserScript==([\s\S]*?\n)\s*\/\/\x20==\/UserScript==|$/;
