import { USERSCRIPT_META_INTRO } from '@/common/consts';
import { USERSCRIPT_META_HEADERS } from '@/common/userscript-meta';

const USERSCRIPT_OPEN_RE = new RegExp(`^\\s*//[\\x20\\t]*${USERSCRIPT_META_INTRO}\\s*$`);
const USERSCRIPT_CLOSE_RE = /^\s*\/\/[\x20\t]*==\/UserScript==\s*$/;
const META_LINE_RE = /^\s*\/\/[\x20\t]/;

/** @param {CodeMirror.Editor} cm */
export function isInUserScriptMetaBlock(cm) {
  const { line } = cm.getCursor();
  let startLine = -1;
  for (let i = 0; i <= line; i += 1) {
    if (USERSCRIPT_OPEN_RE.test(cm.getLine(i))) startLine = i;
  }
  if (startLine < 0 || line <= startLine) return false;
  for (let i = startLine + 1; i < cm.lineCount(); i += 1) {
    if (USERSCRIPT_CLOSE_RE.test(cm.getLine(i))) {
      return line < i;
    }
  }
  return false;
}

/** @param {CodeMirror.Editor} cm */
export function getUserScriptMetaHint(cm) {
  if (!isInUserScriptMetaBlock(cm)) return null;
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line);
  if (!META_LINE_RE.test(line)) return null;
  const before = line.slice(0, cur.ch);
  const match = before.match(/@([\w-:]*)$/);
  if (!match) return null;
  const prefix = match[1].toLowerCase();
  const list = USERSCRIPT_META_HEADERS
    .filter(key => key.toLowerCase().startsWith(prefix))
    .map(key => `@${key}`);
  if (!list.length) return null;
  return {
    list,
    from: { line: cur.line, ch: cur.ch - match[0].length },
    to: cur,
  };
}
