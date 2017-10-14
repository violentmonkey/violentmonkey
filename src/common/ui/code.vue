<template>
  <div class="flex flex-col">
    <vl-code class="editor-code flex-auto"
      :options="cmOptions" v-model="content" @ready="onReady"
    />
    <div class="frame-block" v-show="search.show">
      <button class="pull-right" @click="clearSearch">&times;</button>
      <form class="inline-block mr-1" @submit.prevent="goToLine()">
        <span v-text="i18n('labelLineNumber')"></span>
        <input class="w-1" v-model="search.line">
      </form>
      <form class="inline-block mr-1" @submit.prevent="findNext()">
        <span v-text="i18n('labelSearch')"></span>
        <tooltip title="Ctrl-F">
          <input ref="search" v-model="search.state.query">
        </tooltip>
        <tooltip title="Shift-Ctrl-G">
          <button type="button" @click="findNext(1)">&lt;</button>
        </tooltip>
        <tooltip title="Ctrl-G">
          <button type="submit">&gt;</button>
        </tooltip>
      </form>
      <form class="inline-block mr-1" @submit.prevent="replace()" v-if="!readonly">
        <span v-text="i18n('labelReplace')"></span>
        <input v-model="search.state.replace">
        <tooltip title="Shift-Ctrl-F">
          <button type="submit" v-text="i18n('buttonReplace')"></button>
        </tooltip>
        <tooltip title="Shift-Ctrl-R">
          <button type="button" v-text="i18n('buttonReplaceAll')" @click="replace(1)"></button>
        </tooltip>
      </form>
    </div>
  </div>
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
import VlCode from 'vueleton/lib/code';
import { debounce } from 'src/common';
import Tooltip from './tooltip';

function getHandler(key) {
  return cm => {
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
      'end',
      '+input',
    );
  }
}

[
  'save', 'cancel', 'find', 'findNext', 'findPrev', 'replace', 'replaceAll', 'close',
].forEach(key => {
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

function findNext(cm, state, reversed) {
  cm.operation(() => {
    const query = state.query || '';
    let cursor = cm.getSearchCursor(query, reversed ? state.posFrom : state.posTo);
    if (!cursor.find(reversed)) {
      cursor = cm.getSearchCursor(
        query,
        reversed ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0),
      );
      if (!cursor.find(reversed)) return;
    }
    cm.setSelection(cursor.from(), cursor.to());
    state.posFrom = cursor.from();
    state.posTo = cursor.to();
  });
}
function replaceOne(cm, state) {
  const start = cm.getCursor('start');
  const end = cm.getCursor('end');
  state.posTo = state.posFrom;
  findNext(cm, state);
  const start2 = cm.getCursor('start');
  const end2 = cm.getCursor('end');
  if (
    start.line === start2.line && start.ch === start2.ch
    && end.line === end2.line && end.ch === end2.ch
  ) {
    cm.replaceRange(state.replace, start, end);
    findNext(cm, state);
  }
}
function replaceAll(cm, state) {
  cm.operation(() => {
    const query = state.query || '';
    for (let cursor = cm.getSearchCursor(query); cursor.findNext();) {
      cursor.replace(state.replace);
    }
  });
}

export default {
  props: {
    readonly: {
      type: Boolean,
      default: false,
    },
    value: true,
    commands: true,
    global: {
      type: Boolean,
      default: true,
    },
  },
  components: {
    VlCode,
    Tooltip,
  },
  data() {
    return {
      cmOptions,
      content: this.value,
      search: {
        show: false,
        state: {
          query: null,
          replace: null,
        },
      },
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
      this.$nextTick(() => {
        cm.getDoc().clearHistory();
        cm.focus();
      });
    },
    'search.state.query'() {
      this.debouncedFind();
    },
  },
  methods: {
    onReady(cm) {
      this.cm = cm;
      if (this.readonly) cm.setOption('readOnly', true);
      cm.state.commands = Object.assign({
        cancel: () => {
          if (this.search.show) {
            this.clearSearch();
          } else {
            cm.execCommand('close');
          }
        },
        find: this.find,
        findNext: this.findNext,
        findPrev: () => {
          this.findNext(1);
        },
        replace: this.replace,
        replaceAll: () => {
          this.replace(1);
        },
      }, this.commands);
      cm.setOption('extraKeys', {
        Esc: 'cancel',
        Tab: indentWithTab,
      });
      cm.on('keyHandled', (_cm, _name, e) => {
        e.stopPropagation();
      });
      this.$emit('ready', cm);
    },
    onKeyDown(e) {
      const name = CodeMirror.keyName(e);
      const { cm } = this;
      [
        cm.options.extraKeys,
        cm.options.keyMap,
      ].some(keyMap => {
        let stop = false;
        if (keyMap) {
          CodeMirror.lookupKey(name, keyMap, b => {
            if (cm.state.commands[b]) {
              e.preventDefault();
              e.stopPropagation();
              cm.execCommand(b);
              stop = true;
            }
          }, cm);
        }
        return stop;
      });
    },
    doFind(reversed) {
      const { state } = this.search;
      const { cm } = this;
      if (state.query) {
        findNext(cm, state, reversed);
      }
      this.search.show = true;
    },
    find() {
      const { state } = this.search;
      state.posTo = state.posFrom;
      this.doFind();
      this.$nextTick(() => {
        const { search } = this.$refs;
        search.select();
        search.focus();
      });
    },
    findNext(reversed) {
      this.doFind(reversed);
      this.$nextTick(() => {
        this.$refs.search.focus();
      });
    },
    clearSearch() {
      const { cm } = this;
      cm.operation(() => {
        const { state } = this.search;
        state.posFrom = null;
        state.posTo = null;
        this.search.show = false;
      });
      cm.focus();
    },
    replace(all) {
      const { cm } = this;
      const { state } = this.search;
      if (!state.query) {
        this.find();
        return;
      }
      (all ? replaceAll : replaceOne)(cm, state);
    },
    goToLine() {
      const { cm } = this;
      const line = +this.search.line;
      if (line > 0) cm.setCursor(line - 1, 0);
      cm.focus();
    },
  },
  mounted() {
    this.debouncedFind = debounce(this.doFind, 100);
    if (this.global) window.addEventListener('keydown', this.onKeyDown, false);
  },
  beforeDestroy() {
    if (this.global) window.removeEventListener('keydown', this.onKeyDown, false);
  },
};
</script>
