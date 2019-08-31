<template>
  <div class="flex flex-col">
    <div class="frame-block editor-search" v-show="search.show">
      <button class="pull-right" @click="clearSearch">&times;</button>
      <form class="inline-block mr-1" @submit.prevent="goToLine()">
        <span v-text="i18n('labelLineNumber')"></span>
        <input type="text" class="w-1" v-model="search.line">
      </form>
      <form class="inline-block mr-1" @submit.prevent="findNext()">
        <span v-text="i18n('labelSearch')"></span>
        <tooltip content="Ctrl-F">
          <input
            :class="{ 'is-error': !search.state.hasResult }"
            type="text"
            ref="search"
            v-model="search.state.query"
          />
        </tooltip>
        <tooltip content="Shift-Ctrl-G">
          <button type="button" @click="findNext(1)">&lt;</button>
        </tooltip>
        <tooltip content="Ctrl-G">
          <button type="submit">&gt;</button>
        </tooltip>
      </form>
      <form class="inline-block mr-1" @submit.prevent="replace()" v-if="!readonly">
        <span v-text="i18n('labelReplace')"></span>
        <input type="text" v-model="search.state.replace">
        <tooltip content="Shift-Ctrl-F">
          <button type="submit" v-text="i18n('buttonReplace')"></button>
        </tooltip>
        <tooltip content="Shift-Ctrl-R">
          <button type="button" v-text="i18n('buttonReplaceAll')" @click="replace(1)"></button>
        </tooltip>
      </form>
      <div class="inline-block">
        <tooltip :content="i18n('searchUseRegex')">
          <toggle-button v-model="searchOptions.useRegex">.*</toggle-button>
        </tooltip>
        <tooltip :content="i18n('searchCaseSensitive')">
          <toggle-button v-model="searchOptions.caseSensitive">Aa</toggle-button>
        </tooltip>
      </div>
    </div>
    <div class="editor-code flex-auto" ref="code"></div>
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
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/brace-fold';
import 'codemirror/addon/fold/comment-fold';
import 'codemirror/addon/search/match-highlighter';
import 'codemirror/addon/search/searchcursor';
import 'codemirror/addon/selection/active-line';
import CodeMirror from 'codemirror';
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { debounce } from '#/common';
import ToggleButton from '#/common/ui/toggle-button';
import options from '#/common/options';

/* eslint-disable no-control-regex */
const MAX_LINE_LENGTH = 50 * 1024;
// Make sure this is still the longest line in the doc
const CTRL_OPEN = '\x02'.repeat(256);
const CTRL_CLOSE = '\x03'.repeat(256);

function getHandler(key) {
  return (cm) => {
    const { commands } = cm.state;
    const handle = commands && commands[key];
    return handle && handle();
  };
}

[
  'save', 'cancel', 'close',
  'find', 'findNext', 'findPrev', 'replace', 'replaceAll',
].forEach((key) => {
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
  mode: 'javascript',
  lineNumbers: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  highlightSelectionMatches: true,
};
const searchOptions = {
  useRegex: false,
  caseSensitive: false,
};

function findUnmarked(cursor, reversed) {
  while (cursor.find(reversed)) {
    const marks = cursor.doc.findMarksAt(cursor.from(), cursor.to());
    if (!marks.length) return true;
  }
  return false;
}

function findNext(cm, state, reversed) {
  cm.operation(() => {
    let query = state.query || '';
    if (!query) {
      state.hasResult = true;
      return;
    }
    if (query && searchOptions.useRegex) {
      query = new RegExp(query, searchOptions.caseSensitive ? '' : 'i');
    }
    const cOptions = {
      caseFold: !searchOptions.caseSensitive,
    };
    let cursor = cm.getSearchCursor(query, reversed ? state.posFrom : state.posTo, cOptions);
    if (!findUnmarked(cursor, reversed)) {
      cursor = cm.getSearchCursor(
        query,
        reversed ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0),
        cOptions,
      );
      if (!findUnmarked(cursor, reversed)) {
        state.hasResult = false;
        return;
      }
    }
    cm.setSelection(cursor.from(), cursor.to());
    state.posFrom = cursor.from();
    state.posTo = cursor.to();
    state.hasResult = true;
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
    for (let cursor = cm.getSearchCursor(query); findUnmarked(cursor);) {
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
    value: {
      type: String,
      default: '',
    },
    commands: {
      type: Object,
      default: null,
    },
    global: {
      type: Boolean,
      default: true,
    },
  },
  components: {
    Tooltip,
    ToggleButton,
  },
  data() {
    return {
      cmOptions,
      searchOptions,
      content: '',
      search: {
        show: false,
        state: {
          query: null,
          replace: null,
          hasResult: false,
        },
      },
    };
  },
  watch: {
    value(value) {
      if (value === this.cached) return;
      this.cached = value;
      const placeholders = [];
      this.content = value.replace(/[\x02\x03]/g, '')
      .split('\n')
      .map((line, i) => {
        if (line.length > MAX_LINE_LENGTH) {
          const matches = line.match(/^(\s*)(.*)$/);
          const prefix = matches[1];
          const body = matches[2];
          const id = placeholders.length;
          const replaced = `${CTRL_OPEN}${id}${CTRL_CLOSE}`;
          const placeholder = {
            id,
            body,
            line: i,
            start: prefix.length,
            length: replaced.length,
          };
          placeholders.push(placeholder);
          return `${prefix}${replaced}`;
        }
        return line;
      })
      .join('\n');
      this.placeholders = placeholders;
      const { cm } = this;
      if (!cm) return;
      cm.off('change', this.onChange);
      cm.setValue(this.content || '');
      placeholders.forEach(({
        line, start, body, length,
      }) => {
        const span = document.createElement('span');
        span.textContent = `${body.slice(0, MAX_LINE_LENGTH)}...`;
        const mark = cm.markText({ line, ch: start }, { line, ch: start + length }, {
          replacedWith: span,
        });
        span.addEventListener('click', debounce(() => {
          if (!window.getSelection().toString()) {
            const { from } = mark.find();
            cm.setCursor(from);
            cm.focus();
          }
        }));
      });
      cm.getDoc().clearHistory();
      cm.focus();
      cm.on('change', this.onChange);
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
    onChange: debounce(function onChange() {
      const content = this.getRealContent(this.cm.getValue());
      this.cached = content;
      this.$emit('input', content);
    }, 200),
    initialize(cm) {
      this.cm = cm;
      cm.setOption('readOnly', this.readonly);
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
      ].some((keyMap) => {
        let stop = false;
        if (keyMap) {
          CodeMirror.lookupKey(name, keyMap, (b) => {
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
      findNext(cm, state, reversed);
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
      if (!this.cm || !this.cm.somethingSelected()) return;
      const text = this.getRealContent(this.cm.getSelection());
      e.clipboardData.setData('text', text);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    getRealContent(text) {
      return text.replace(/\x02+(\d+)\x03+/g, (_, id) => {
        const placeholder = this.placeholders[id];
        return placeholder && placeholder.body || '';
      });
    },
  },
  mounted() {
    this.initialize(CodeMirror(
      this.$refs.code,
      Object.assign({}, this.cmOptions, options.get('editor')),
    ));
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

.editor-search > .inline-block > * {
  display: inline-block;
  vertical-align: middle;
  white-space: pre;
}

input[type=text].is-error {
  border: 1px solid #e85600;
  background: #e8560010;
}
</style>
