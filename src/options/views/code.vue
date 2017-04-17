<template>
  <div class="editor-code"></div>
</template>

<script>
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/eclipse.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/comment/continuecomment';
import 'codemirror/addon/edit/matchbrackets';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/fold/foldcode';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import 'codemirror/addon/fold/comment-fold';
import 'codemirror/addon/search/match-highlighter';
import 'codemirror/addon/search/searchcursor';
import 'codemirror/addon/selection/active-line';
import CodeMirror from 'codemirror';

function getHandler(key) {
  return (cm) => {
    const { commands } = cm.state;
    const handle = commands && commands[key];
    return handle && handle();
  };
}
function indentWithTab(cm) {
  if (cm.somethingSelected()) {
    cm.indentSelection('add');
  } else {
    cm.replaceSelection(
      cm.getOption('indentWithTabs') ? '\t' : ' '.repeat(cm.getOption('indentUnit')),
      'end', '+input');
  }
}

[
  'save', 'cancel', 'find', 'findNext', 'findPrev', 'replace', 'replaceAll',
].forEach((key) => {
  CodeMirror.commands[key] = getHandler(key);
});

export default {
  props: [
    'readonly',
    'content',
    'commands',
  ],
  mounted() {
    const cm = CodeMirror(this.$el, {
      continueComments: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      highlightSelectionMatches: true,
      lineNumbers: true,
      mode: 'javascript',
      lineWrapping: true,
      styleActiveLine: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      theme: 'eclipse',
    });
    this.cm = cm;
    if (this.readonly) cm.setOption('readOnly', true);
    cm.on('change', () => {
      this.cachedContent = cm.getValue();
      this.$emit('change', this.cachedContent);
    });
    cm.state.commands = this.commands;
    cm.setOption('extraKeys', {
      Esc: 'cancel',
      Tab: indentWithTab,
    });
    cm.on('keyHandled', (_cm, _name, e) => {
      e.stopPropagation();
    });
    this.setContent(this.content);
    this.$emit('ready', cm);
  },
  watch: {
    content: 'setContent',
  },
  methods: {
    setContent(content) {
      if (content !== this.cachedContent) {
        this.cachedContent = content;
        const { cm } = this;
        if (!cm) return;
        cm.setValue(content);
        cm.getDoc().clearHistory();
        cm.focus();
      }
    },
  },
};
</script>
