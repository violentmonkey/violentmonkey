import CodeMirror from 'codemirror';
import {
  defaultsEditor as DEFAULTS,
  kKillTrailingSpaceOnSave as KILL_OPT,
  kShowTrailingSpace as SHOW_OPT,
} from '@/common/options-defaults';

const OVERLAY = 'trailingspace';
if (!''.trimEnd) {
  // TODO: remove when min_chrome_version>=66, strict_min_version>=61
  String.prototype.trimEnd = function _() {
    return this.replace(/\s+$/, '');
  };
}

export const killTrailingSpaces = (cm, placeholders) => {
  if (!cm.options[KILL_OPT]) {
    return cm.getValue();
  }
  const cursorLines = cm.doc.sel.ranges.map(r => r.head.line);
  let res = ''; // progressive concatenation is efficient in modern browsers
  let line = 0;
  cm.operation(() => {
    cm.eachLine(({ text }) => {
      const trimmed = text.trimEnd();
      const len1 = trimmed.length;
      const len2 = text.length;
      res += (line ? '\n' : '') + trimmed;
      // The saved code is fully trimmed, but we keep the spaces in cursor line(s)
      if (len1 !== len2 && !cursorLines.includes(line)) {
        cm.replaceRange('',
          { line, ch: len1 },
          { line, ch: len2 },
          `*${KILL_OPT}`); // `*` reuses the same undo record for performance
      }
      line += 1;
    });
  });
  placeholders.forEach(p => {
    p.body = p.body.trimEnd();
  });
  return res;
};

CodeMirror.defineOption(SHOW_OPT, DEFAULTS[SHOW_OPT], (cm, val, prev) => {
  if (prev === CodeMirror.Init) prev = false;
  if (prev && !val) {
    cm.removeOverlay(OVERLAY);
  } else if (!prev && val) {
    cm.addOverlay({
      token(stream) {
        const s = stream.string;
        const i = /\s*$/.exec(s).index;
        if (i > stream.pos) {
          stream.pos = i;
          return null;
        }
        stream.pos = s.length;
        return OVERLAY;
      },
      name: OVERLAY,
    });
  }
});

for (const key of [KILL_OPT, SHOW_OPT]) {
  CodeMirror.defaults[key] = DEFAULTS[key];
}
