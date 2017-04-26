<template>
  <vue-code class="editor-code"
    :options="cmOptions" v-model="content" @ready="onReady"
  />
</template>

<script>
import VueCode from 'vue-code';
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

const cmOptions = {
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
};

export default {
  props: [
    'readonly',
    'value',
    'commands',
  ],
  components: {
    VueCode,
  },
  data() {
    return {
      content: this.value,
      cmOptions,
    };
  },
  watch: {
    content(content) {
      this.$emit('input', content);
    },
    value(value) {
      if (value === this.content) return;
      this.content = value;
      const { cm } = this;
      if (!cm) return;
      cm.getDoc().clearHistory();
      cm.focus();
    },
  },
  methods: {
    onReady(cm) {
      this.cm = cm;
      if (this.readonly != null) cm.setOption('readOnly', true);
      cm.state.commands = this.commands;
      cm.setOption('extraKeys', {
        Esc: 'cancel',
        Tab: indentWithTab,
      });
      cm.on('keyHandled', (_cm, _name, e) => {
        e.stopPropagation();
      });
      this.$emit('ready', cm);
    },
  },
};
</script>
