<template>
  <div class="flex flex-col">
    <div class="frame-block editor-search flex" v-show="search.show">
      <form @submit.prevent="goToLine()">
        <span v-text="i18n('labelLineNumber')"></span>
        <input type="text" class="w-1" v-model="search.line">
      </form>
      <form class="flex-1" @submit.prevent="findNext()">
        <span v-text="i18n('labelSearch')"></span>
        <tooltip content="Ctrl-F" class="flex-1">
          <!-- id is required for the built-in autocomplete using entered values -->
          <input
            :class="{ 'is-error': !search.state.hasResult }"
            type="search"
            id="editor-search"
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
      <form class="flex-1" @submit.prevent="replace()" v-if="!readonly">
        <span v-text="i18n('labelReplace')"></span>
        <!-- id is required for the built-in autocomplete using entered values -->
        <input class="flex-1" type="search" id="editor-replace" v-model="search.state.replace">
        <tooltip content="Shift-Ctrl-F">
          <button type="submit" v-text="i18n('buttonReplace')"></button>
        </tooltip>
        <tooltip content="Shift-Ctrl-R">
          <button type="button" v-text="i18n('buttonReplaceAll')" @click="replace(1)"></button>
        </tooltip>
      </form>
      <div>
        <tooltip :content="i18n('searchUseRegex')">
          <toggle-button v-model="searchOptions.useRegex">.*</toggle-button>
        </tooltip>
        <tooltip :content="i18n('searchCaseSensitive')">
          <toggle-button v-model="searchOptions.caseSensitive">Aa</toggle-button>
        </tooltip>
      </div>
      <button @click="clearSearch">&times;</button>
    </div>
    <div class="editor-code flex-auto" ref="code"></div>
  </div>
</template>

<script>
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/eclipse.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/comment/continuecomment';
import 'codemirror/addon/comment/comment';
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
import 'codemirror/keymap/sublime';
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/hint/show-hint.js';
import 'codemirror/addon/hint/anyword-hint.js';
import CodeMirror from 'codemirror';
import Tooltip from 'vueleton/lib/tooltip/bundle';
import ToggleButton from '#/common/ui/toggle-button';
import { debounce } from '#/common';
import { forEachEntry, deepEqual } from '#/common/object';
import hookSetting from '#/common/hook-setting';
import options from '#/common/options';

/* eslint-disable no-control-regex */
const MAX_LINE_LENGTH = 50 * 1024;
// Make sure this is still the longest line in the doc
const CTRL_OPEN = '\x02'.repeat(256);
const CTRL_CLOSE = '\x03'.repeat(256);

[
  'save', 'cancel', 'close',
  'find', 'findNext', 'findPrev', 'replace', 'replaceAll',
].forEach((key) => {
  CodeMirror.commands[key] = cm => cm.state.commands?.[key]?.();
});
Object.assign(CodeMirror.keyMap.sublime, {
  'Shift-Ctrl-/': 'commentSelection',
});
CodeMirror.commands.commentSelection = cm => {
  cm.blockComment(cm.getCursor('from'), cm.getCursor('to'), { fullLines: false });
};
// pressing Tab key inside a line with no selection will reuse indent type (tabs/spaces)
const { insertTab, insertSoftTab } = CodeMirror.commands;
CodeMirror.commands.insertTab = cm => (
  cm.options.indentWithTabs ? insertTab(cm) : insertSoftTab(cm)
);

CodeMirror.commands.autocomplete = (cm) => {
  cm.showHint({hint: CodeMirror.hint.anyword});
};

export const cmOptions = {
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
  keyMap: 'sublime',
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
    active: Boolean,
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
    active: 'onActive',
    value(value) {
      if (value === this.cached) return;
      this.cached = value;
      const placeholders = [];
      this.content = value.replace(/[\x02\x03]/g, '')
      .split('\n')
      .map((line, i) => {
        if (line.length > MAX_LINE_LENGTH) {
          const prefix = line.match(/^\s*/)[0];
          const body = line.slice(prefix.length);
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
      cm.off('changes', this.onChange);
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
      cm.on('changes', this.onChange);
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
      // these are active only in the code nav tab
      cm.state.commands = Object.assign({
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
      // these are active in all nav tabs
      cm.setOption('extraKeys', {
        Esc: 'cancel',
        F1: 'showHelp',
        "Ctrl-Space": "autocomplete",
      });
      Object.assign(CodeMirror.commands, {
        cancel: () => {
          if (this.search.show) {
            this.clearSearch();
          } else {
            cm.execCommand('close');
          }
        },
        showHelp: this.commands.showHelp,
      });
      cm.on('keyHandled', (_cm, _name, e) => {
        e.stopPropagation();
      });
      this.$emit('ready', cm);
    },
    onActive(state) {
      const onOff = state ? 'on' : 'off';
      this.cm[onOff]('blur', this.onKeyDownToggler);
      this.cm[onOff]('focus', this.onKeyDownToggler);
      if (state) {
        this.cm?.focus();
      } else {
        window.removeEventListener('keydown', this.onKeyDown);
      }
    },
    /* reroute hotkeys back to CM when it isn't focused,
       but ignore `window` blur (`evt` param is absent) */
    onKeyDownToggler(cm, evt) {
      if (evt) {
        window[`${evt.type === 'blur' ? 'add' : 'remove'}EventListener`]('keydown', this.onKeyDown);
      }
    },
    onKeyDown(e) {
      const name = CodeMirror.keyName(e);
      if (!this.cm) return;
      [
        this.cm.options.extraKeys,
        this.cm.options.keyMap,
      ].some(keyMap => keyMap && this.lookupKey(name, keyMap, e) === 'handled');
    },
    lookupKey(name, keyMap, e) {
      return CodeMirror.lookupKey(name, keyMap, (b) => {
        if (keyMap === this.cm.options.extraKeys || this.cm.state.commands[b]) {
          e.preventDefault();
          e.stopPropagation();
          this.cm.execCommand(b);
          return true;
        }
      }, this.cm);
    },
    findFillQuery(force) {
      const { state } = this.search;
      const { cm } = this;
      if (!state.query || force) {
        const sel = cm.listSelections();
        // use the currently selected text if it's within one line
        if (sel?.length === 1 && sel[0].anchor.line === sel[0].head.line) {
          state.query = cm.getSelection();
        }
      }
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
      this.findFillQuery(true);
      this.searchInPlace();
      this.$nextTick(() => {
        const { search } = this.$refs;
        search.select();
        search.focus();
      });
    },
    findNext(reversed) {
      this.findFillQuery();
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
      return text.replace(/\x02+(\d+)\x03+/g, (_, id) => this.placeholders[id]?.body || '');
    },
  },
  mounted() {
    let userOpts = options.get('editor');
    const opts = { ...this.cmOptions, ...userOpts };
    this.initialize(CodeMirror(this.$refs.code, opts));
    // pressing Tab key inside a line with no selection will reuse indent size
    if (!opts.tabSize) this.cm.options.tabSize = this.cm.options.indentUnit;
    this.debouncedFind = debounce(this.searchInPlace, 100);
    this.$refs.code.addEventListener('copy', this.onCopy);
    this.onActive(true);
    hookSetting('editor', (newUserOpts) => {
      // Use defaults for keys that were present in the old userOpts but got deleted in newUserOpts
      ({ ...this.cmOptions, ...newUserOpts })::forEachEntry(([key, val]) => {
        if ((key in newUserOpts || key in userOpts)
        && !deepEqual(this.cm.getOption(key), val)) {
          this.cm.setOption(key, val);
        }
      });
      userOpts = newUserOpts;
    });
  },
  beforeDestroy() {
    this.onActive(false);
  },
};
</script>

<style>
$selectionBg: #d7d4f0; /* copied from codemirror.css */
$selectionDarkBg: rgba(73, 72, 62, .99);

/* compatible with old browsers, e.g. Maxthon 4.4, Chrome 50- */
.editor-code.flex-auto {
  position: relative;
  > div {
    position: absolute;
    width: 100%;
  }
}

.editor-search {
  white-space: pre;
  flex-wrap: wrap; // wrap fields in a narrow window
  > form,
  > div {
    display: flex;
    align-items: center;
    margin-right: .5rem;
  }
  input[type=search] {
    min-width: 8em;
  }
  span > input { // a tooltip'ed input
    width: 100%;
  }
  .is-error {
    border-color: #e85600;
    background: #e8560010;
  }
}

/* CodeMirror show-hints fix to work here */
.CodeMirror-hints {
  z-index: 9999;
  /* consistent font with the rest, copied from .monospace-font rule from style/style.css */
  font-family: "Fira Code", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", Courier, monospace;
}

@media (prefers-color-scheme: dark) {
  .CodeMirror-hints {
    background: var(--bg);
  }
  .CodeMirror-hint {
    color: var(--fg);
  }
  li.CodeMirror-hint-active {
    background:white ;
    color: #08f;
  }
}

/* fix contenteditable selection color bug */
.cm-s-eclipse .CodeMirror-line {
  ::selection {
    background: $selectionBg;
  }
  /* must be used separately otherwise the entire rule is ignored in Chrome */
  ::-moz-selection {
    background: $selectionBg;
  }
}

.cm-matchhighlight {
  background-color: hsla(168, 100%, 50%, 0.15);
}

@media (prefers-color-scheme: dark) {
  .cm-matchhighlight {
    background-color: hsla(40, 100%, 50%, 0.1);
  }
  // mostly copied from Monokai theme
  .cm-s-eclipse {
    &.CodeMirror {
      color: var(--fg);
      background: var(--bg);
    }
    .CodeMirror {
      &-scrollbar-filler,
      &-gutter-filler {
        background: none;
      }
      &-gutters {
        border-color: var(--fill-2);
        background-color: var(--fill-0-5);
      }
      &-selected {
        background: #49483e;
      }
      &-line {
        ::selection {
          background: $selectionDarkBg;
        }
        /* must be used separately otherwise the entire rule is ignored in Chrome */
        ::-moz-selection {
          background: $selectionDarkBg;
        }
      }
      &-guttermarker {
        color: white;
        &-subtle {
          color: #d0d0d0;
        }
      }
      &-linenumber {
        color: #666;
      }
      &-cursor {
        border-color: #f8f8f0;
      }
      &-activeline-background {
        background: #1a1a1a;
      }
      &-matchingbracket {
        outline: none;
        background: #444;
        color: yellow !important;
      }
    }
    span {
      &.cm-comment {
        color: #75715e;
      }
      &.cm-atom {
        color: #ae81ff;
      }
      &.cm-number {
        color: #ae81ff;
      }
      &.cm-comment.cm-attribute {
        color: #97b757;
      }
      &.cm-comment.cm-def {
        color: #bc9262;
      }
      &.cm-comment.cm-tag {
        color: #bc6283;
      }
      &.cm-comment.cm-type {
        color: #5998a6;
      }
      &.cm-property,
      &.cm-attribute {
        color: #a6e22e;
      }
      &.cm-keyword {
        color: #f92672;
      }
      &.cm-builtin {
        color: #66d9ef;
      }
      &.cm-string {
        color: #e6db74;
      }
      &.cm-string-2 {
        color: #bcb149;
      }
      &.cm-variable {
        color: #f8f8f2;
      }
      &.cm-variable-2 {
        color: #9effff;
      }
      &.cm-variable-3,
      &.cm-type {
        color: #66d9ef;
      }
      &.cm-def {
        color: #fd971f;
      }
      &.cm-bracket {
        color: #f8f8f2;
      }
      &.cm-tag {
        color: #f92672;
      }
      &.cm-header {
        color: #ae81ff;
      }
      &.cm-link {
        color: #ae81ff;
      }
      &.cm-error {
        color: #f8f8f0;
        background: #f92672;
      }
      &.cm-operator {
        color: #999
      }
    }
  }
}
</style>
