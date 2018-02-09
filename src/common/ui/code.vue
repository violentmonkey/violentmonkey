<template>
  <div class="flex flex-col">
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
      <div class="inline-block">
        <tooltip :title="i18n('searchUseRegex')">
          <toggle-button v-model="searchOptions.useRegex">.*</toggle-button>
        </tooltip>
        <tooltip :title="i18n('searchCaseSensitive')">
          <toggle-button v-model="searchOptions.caseSensitive">Aa</toggle-button>
        </tooltip>
      </div>
    </div>
    <vl-code
      class="editor-code flex-auto"
      :options="cmOptions" v-model="content" @ready="onReady"
    />
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
import Tooltip from 'vueleton/lib/tooltip';
import { debounce } from 'src/common';
import ToggleButton from 'src/common/ui/toggle-button';

function getHandler(key) {
  return cm => {
    const { commands } = cm.state;
    const handle = commands && commands[key];
    return handle && handle();
  };
}

[
  'save', 'cancel', 'close',
  'find', 'findNext', 'findPrev', 'replace', 'replaceAll',
].forEach(key => {
  CodeMirror.commands[key] = getHandler(key);
});
Object.assign(CodeMirror.keyMap.default, {
  Tab: 'indentMore',
  'Shift-Tab': 'indentLess',
});

const cmOptions = {
  continueComments: true,
  styleActiveLine: true,
  foldGutter: true,
  gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  theme: 'eclipse',
};
const searchOptions = {
  useRegex: false,
  caseSensitive: false,
};

function findNext(cm, state, reversed) {
  cm.operation(() => {
    let query = state.query || '';
    if (query && searchOptions.useRegex) {
      query = new RegExp(query, searchOptions.caseSensitive ? '' : 'i');
    }
    const options = {
      caseFold: !searchOptions.caseSensitive,
    };
    let cursor = cm.getSearchCursor(query, reversed ? state.posFrom : state.posTo, options);
    if (!cursor.find(reversed)) {
      cursor = cm.getSearchCursor(
        query,
        reversed ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0),
        options,
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
    ToggleButton,
  },
  data() {
    return {
      cmOptions,
      searchOptions,
      content: null,
      lineTooLong: false,
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
      const { cut, cutLines } = this.getCutContent(value);
      this.lineTooLong = cut && cutLines;
      this.checkOptions();
      this.content = cut ? cutLines.map(({ text }) => text).join('\n') : value;
      this.$emit('warnLarge', !!this.lineTooLong);
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
    searchOptions: {
      deep: true,
      handler() {
        this.debouncedFind();
      },
    },
  },
  methods: {
    checkOptions() {
      const { cm, lineTooLong } = this;
      if (!cm) return;
      cm.setOption('readOnly', !!(lineTooLong || this.readonly));
      cm.setOption('mode', lineTooLong ? 'null' : 'javascript');
      cm.setOption('lineNumbers', !lineTooLong);
      cm.setOption('lineWrapping', !lineTooLong);
      cm.setOption('matchBrackets', !lineTooLong);
      cm.setOption('autoCloseBrackets', !lineTooLong);
      cm.setOption('highlightSelectionMatches', !lineTooLong);
    },
    getCutContent(value) {
      const lines = value.split('\n');
      const cut = lines.some(line => line.length > 50000);
      const cutLines = [];
      if (cut) {
        const maxLength = 3 * 1024;
        lines.forEach((line, index) => {
          for (let offset = 0; offset < line.length; offset += maxLength) {
            cutLines.push({
              index,
              text: line.slice(offset, offset + maxLength),
            });
          }
          if (!line.length) {
            cutLines.push({
              index,
              text: '',
            });
          }
        });
      }
      return { cut, cutLines };
    },
    onReady(cm) {
      this.cm = cm;
      this.checkOptions();
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
      });
      cm.on('keyHandled', (_cm, _name, e) => {
        e.stopPropagation();
      });
      this.$emit('ready', cm);
    },
    onKeyDown(e) {
      const name = CodeMirror.keyName(e);
      const { cm } = this;
      if (!cm) return;
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
    doSearch(reversed) {
      const { state } = this.search;
      const { cm } = this;
      if (state.query) {
        findNext(cm, state, reversed);
      }
      this.search.show = true;
    },
    searchInPlace() {
      const { state } = this.search;
      state.posTo = state.posFrom;
      this.doSearch();
    },
    find() {
      this.searchInPlace();
      this.$nextTick(() => {
        const { search } = this.$refs;
        search.select();
        search.focus();
      });
    },
    findNext(reversed) {
      this.doSearch(reversed);
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
    onCopy(e) {
      if (!this.lineTooLong || !this.cm || !this.cm.somethingSelected()) return;
      const [rng] = this.cm.listSelections();
      const positions = {};
      [rng.anchor, rng.head].forEach(pos => {
        positions[pos.sticky] = pos;
      });
      const meta = [];
      {
        let { line, ch } = positions.after;
        for (; line < positions.before.line; line += 1) {
          meta.push({ line, from: ch });
          ch = 0;
        }
        meta.push({ line, from: ch, to: positions.before.ch });
      }
      const result = [];
      let lastLine;
      meta.forEach(({ line, from, to }) => {
        const { text, index } = this.lineTooLong[line];
        if (lastLine != null && lastLine !== index) {
          result.push('\n');
        }
        lastLine = index;
        result.push(to == null ? text.slice(from) : text.slice(from, to));
      });
      e.clipboardData.setData('text', result.join(''));
      e.preventDefault();
      e.stopImmediatePropagation();
    },
  },
  mounted() {
    this.debouncedFind = debounce(this.searchInPlace, 100);
    if (this.global) window.addEventListener('keydown', this.onKeyDown, false);
    document.addEventListener('copy', this.onCopy, false);
  },
  beforeDestroy() {
    if (this.global) window.removeEventListener('keydown', this.onKeyDown, false);
    document.removeEventListener('copy', this.onCopy, false);
  },
};
</script>

<style>
/* compatible with old browsers, e.g. Maxthon 4.4, Chrome 50- */
.editor-code.flex-auto {
  position: relative;
  > div {
    position: absolute;
    width: 100%;
  }
}
</style>
