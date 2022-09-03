import CodeMirror from 'codemirror';

const KILL_OPT = 'killTrailingSpaceOnSave';
const SHOW_OPT = 'showTrailingSpace';
const OVERLAY = 'trailingspace';
const DEFAULTS = {
  [KILL_OPT]: true,
  [SHOW_OPT]: true,
};

export const killTrailingSpaces = (cm, placeholders) => {
  const text = cm.getValue();
  const shouldKill = cm.options[KILL_OPT];
  const trimmed = shouldKill
    ? text.replace(/\s+$/gm, '\n')
    : text;
  if (text !== trimmed) {
    cm.operation(() => {
      const cursorLines = cm.doc.sel.ranges.map(r => r.head.line);
      let line = -1;
      cm.eachLine(({ text: lineText }) => {
        line += 1;
        // The saved code is fully trimmed, but we keep the spaces in cursor line(s)
        if (cursorLines.includes(line)) return;
        const m = /\s+$/.exec(lineText);
        if (m) {
          cm.replaceRange('',
            { line, ch: m.index },
            { line, ch: lineText.length },
            `*${KILL_OPT}`); // `*` reuses the same undo record for performance
        }
      });
    });
  }
  if (shouldKill) {
    placeholders.forEach(p => {
      p.body = p.body.replace(/\s+$/, '');
    });
  }
  return trimmed;
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

Object.assign(CodeMirror.defaults, DEFAULTS);
