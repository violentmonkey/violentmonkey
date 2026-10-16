import { USERSCRIPT_META_HEADERS } from '@/common/userscript-meta';

const USERSCRIPT_OPEN_RE = /^\s*\/\/[\x20\t]*==UserScript==\s*$/;
const USERSCRIPT_CLOSE_RE = /^\s*\/\/[\x20\t]*==\/UserScript==/;

/**
 * Last `// ==UserScript==` at or above `maxLine`.
 * @param {CodeMirror.Editor} cm 
 * @param {number} maxLine 
 * @returns {number}
 */
function getLastUserScriptOpenLine(cm, maxLine) {
  let openLine = -1;
  let lineNo = 0;
  cm.eachLine(0, maxLine + 1, ({ text }) => {
    if (USERSCRIPT_OPEN_RE.test(text)) openLine = lineNo;
    lineNo++;
  });
  return openLine;
}

/**
 * @param {number} line 
 * @param {number} userScriptOpenLine 
 * @returns {boolean}
 */
function isCursorBelowUserScriptOpen(line, userScriptOpenLine) {
  return userScriptOpenLine >= 0 && line > userScriptOpenLine;
}

/**
 * @param {CodeMirror.Editor} cm 
 * @param {number} line 
 * @param {number} userScriptOpenLine 
 * @returns {boolean}
 */
function isCursorAboveUserScriptClose(cm, line, userScriptOpenLine) {
  if (userScriptOpenLine < 0) return false;
  let closeLine = -1;
  let lineNo = userScriptOpenLine + 1;
  cm.eachLine(userScriptOpenLine + 1, cm.lineCount(), ({ text }) => {
    if (closeLine < 0 && USERSCRIPT_CLOSE_RE.test(text)) closeLine = lineNo;
    lineNo++;
  });
  return closeLine >= 0 && line < closeLine;
}

/**
 * @param {CodeMirror.Editor} cm
 * @param {CodeMirror.Pos} [cursor]
 * @returns {boolean}
 */
export function isInUserScriptMetaBlock(cm, cursor = cm.getCursor()) {
  const { line } = cursor;
  const userScriptOpenLine = getLastUserScriptOpenLine(cm, line);

  return isCursorBelowUserScriptOpen(line, userScriptOpenLine) && isCursorAboveUserScriptClose(cm, line, userScriptOpenLine);
}

const META_HEADER_BEFORE_RE = /^\s*\/\/[\x20\t]@([\w-:]*)$/;

/** @param {CodeMirror.Editor} cm */
export function getUserScriptMetaHint(cm) {
  const cur = cm.getCursor();
  const before = cm.getLine(cur.line).slice(0, cur.ch);
  const match = before.match(META_HEADER_BEFORE_RE);
  if (!match || !isInUserScriptMetaBlock(cm, cur)) return;

  const prefix = match[1].toLowerCase();
  const list = USERSCRIPT_META_HEADERS
    .filter(key => key.toLowerCase().startsWith(prefix))
    .map(key => `@${key}`);
  if (!list.length) return;
  return {
    list,
    from: { line: cur.line, ch: cur.ch - match[1].length - 1 },
    to: cur,
  };
}
