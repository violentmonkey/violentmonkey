<template>
  <div class="flex flex-col">
    <div class="editor-code flex-auto" ref="code"></div>
    <div class="frame-block editor-search flex" v-show="search.show">
      <form @submit.prevent="goToLine()">
        <span v-text="i18n('labelLineNumber')"></span>
        <input type="text" class="w-1" v-model="jumpPos">
      </form>
      <form class="flex-1" @submit.prevent="findNext()">
        <span v-text="i18n('labelSearch')"></span>
        <tooltip :content="tooltip.find" class="flex-1">
          <!-- id is required for the built-in autocomplete using entered values -->
          <input
            :class="{ 'is-error': !search.hasResult }"
            :title="search.error"
            type="search"
            id="editor-search"
            ref="search"
            v-model="search.query"
          />
        </tooltip>
        <tooltip :content="tooltip.findPrev">
          <button type="button" @click="findNext(1)">&lt;</button>
        </tooltip>
        <tooltip :content="tooltip.findNext">
          <button type="submit">&gt;</button>
        </tooltip>
      </form>
      <form class="flex-1" @submit.prevent="replace()" v-if="!readonly">
        <span v-text="i18n('labelReplace')"></span>
        <!-- id is required for the built-in autocomplete using entered values -->
        <input class="flex-1" type="search" id="editor-replace" v-model="search.replace">
        <tooltip :content="tooltip.replace">
          <button type="submit" v-text="i18n('buttonReplace')"></button>
        </tooltip>
        <tooltip :content="tooltip.replaceAll">
          <button type="button" v-text="i18n('buttonReplaceAll')" @click="replace(1)"></button>
        </tooltip>
      </form>
      <div>
        <tooltip :content="i18n('searchUseRegex')">
          <toggle-button v-model="search.options.useRegex">.*</toggle-button>
        </tooltip>
        <tooltip :content="i18n('searchCaseSensitive')">
          <toggle-button v-model="search.options.caseSensitive">Aa</toggle-button>
        </tooltip>
      </div>
      <button @click="clearSearch">&times;</button>
    </div>
  </div>
</template>

<script>
import 'codemirror/lib/codemirror.css';
import 'codemirror-js-mixed/mode/javascript-mixed/javascript-mixed';
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
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/javascript-hint';
import 'codemirror/addon/hint/anyword-hint';
import CodeMirror from 'codemirror';
import Tooltip from 'vueleton/lib/tooltip/bundle';
import ToggleButton from '#/common/ui/toggle-button';
import { debounce, i18n } from '#/common';
import { deepEqual, forEachEntry, objectPick } from '#/common/object';
import hookSetting from '#/common/hook-setting';
import options from '#/common/options';
import storage from '#/common/storage';

/* eslint-disable no-control-regex */
let maxDisplayLength;
// Make sure this is still the longest line in the doc
const CTRL_OPEN = '\x02'.repeat(256);
const CTRL_CLOSE = '\x03'.repeat(256);
const CTRL_RE = new RegExp(`${CTRL_OPEN}(\\d+)${CTRL_CLOSE}`, 'g');
const PLACEHOLDER_CLS = 'too-long-placeholder';
// To identify our CodeMirror markers we're using a Symbol since it's always unique
const PLACEHOLDER_SYM = Symbol(PLACEHOLDER_CLS);
const cmDefaults = {
  continueComments: true,
  styleActiveLine: true,
  foldGutter: true,
  gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  theme: 'default',
  mode: 'javascript-mixed',
  lineNumbers: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  highlightSelectionMatches: true,
  keyMap: 'sublime',
  /* Limiting the max length to avoid delays while CodeMirror tries to make sense of a long line.
   * 100kB is fast enough for the main editor (moreover such long lines are rare in the main script),
   * and is big enough to include most of popular minified libraries for the `@resource/@require` viewer. */
  maxDisplayLength: 100_000,
};

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
    mode: String,
    commands: {
      type: Object,
      default: null,
    },
    cmOptions: Object,
  },
  components: {
    Tooltip,
    ToggleButton,
  },
  data() {
    return {
      cmDefaults,
      content: '',
      jumpPos: '',
      search: {
        show: false,
        query: '',
        replace: '',
        hasResult: false,
        options: {
          useRegex: false,
          caseSensitive: false,
        },
      },
      tooltip: {
        find: '',
        findPrev: '',
        findNext: '',
        replace: '',
        replaceAll: '',
      },
    };
  },
  watch: {
    active: 'onActive',
    mode(value) {
      this.cm.setOption('mode', value || cmDefaults.mode);
    },
    value(value) {
      const { cm } = this;
      if (!cm) return;
      const lines = value.split('\n');
      const modified = this.createPlaceholders({ text: lines, from: { line: 0 } });
      cm.off('beforeChange', this.onBeforeChange);
      cm.off('changes', this.onChanges);
      cm.operation(() => {
        cm.setValue(modified ? lines.join('\n') : value);
        if (modified) this.renderPlaceholders();
      });
      cm.clearHistory();
      cm.markClean();
      cm.focus();
      cm.on('changes', this.onChanges);
      cm.on('beforeChange', this.onBeforeChange);
    },
  },
  methods: {
    onBeforeChange(cm, change) {
      if (this.createPlaceholders(change)) {
        cm.on('change', this.onChange); // triggered before DOM is updated
        change.update?.(null, null, change.text);
      }
      // TODO: remove placeholders that belong to a change beyond `undoDepth`
    },
    onChange(cm) {
      cm.off('change', this.onChange);
      this.renderPlaceholders();
    },
    onChanges(cm) {
      this.$emit('code-dirty', !cm.isClean());
    },
    createPlaceholders(change) {
      const { line } = change.from;
      let res = false;
      change.text.forEach((textLine, i) => {
        if (textLine.includes(CTRL_OPEN)) {
          textLine = this.getRealContent(textLine);
        }
        if (textLine.length > maxDisplayLength) {
          res = true;
          this.placeholderId += 1;
          const id = this.placeholderId;
          const prefix = textLine.match(/^\s*/)[0];
          const body = textLine.slice(prefix.length);
          const replaced = `${CTRL_OPEN}${id}${CTRL_CLOSE}`;
          this.placeholders.set(id, {
            body,
            el: null,
            line: line + i,
            ch: prefix.length,
            length: replaced.length,
          });
          change.text[i] = `${prefix}${replaced}`;
        }
      });
      return res;
    },
    renderPlaceholders() {
      this.placeholders.forEach(p => {
        if (!p.el) {
          const { line, ch, body, length } = p;
          const { cm } = this;
          const el = document.createElement('span');
          const marker = cm.markText({ line, ch }, { line, ch: ch + length }, { replacedWith: el });
          marker[PLACEHOLDER_SYM] = true;
          el.className = PLACEHOLDER_CLS;
          el.title = i18n('editLongLineTooltip');
          el.textContent = `${body.slice(0, maxDisplayLength)}...[${i18n('editLongLine')}]`;
          el.onclick = () => {
            if (!`${window.getSelection()}`) {
              cm.setCursor(marker.find().from);
              cm.focus();
            }
          };
          p.el = el;
        }
      });
    },
    initialize(cm) {
      this.cm = cm;
      this.placeholders = new Map();
      this.placeholderId = 0;
      maxDisplayLength = cm.options.maxDisplayLength;
      cm.setOption('readOnly', this.readonly);
      // these are active only in the code nav tab
      cm.state.commands = Object.assign({
        // call own methods explicitly to strip `cm` parameter passed by CodeMirror
        find: () => this.find(),
        findNext: () => this.findNext(),
        findPrev: () => this.findNext(1),
        replace: () => this.replace(),
        replaceAll: () => this.replace(1),
      }, this.commands);
      const { insertTab, insertSoftTab } = CodeMirror.commands;
      Object.assign(CodeMirror.commands, cm.state.commands, {
        autocomplete() {
          cm.showHint({ hint: CodeMirror.hint.autoHintWithFallback });
        },
        cancel: () => {
          if (this.search.show) {
            this.clearSearch();
          } else {
            cm.execCommand('close');
          }
        },
        commentSelection() {
          cm.blockComment(cm.getCursor('from'), cm.getCursor('to'), { fullLines: false });
        },
        insertTab() {
          // pressing Tab key inside a line with no selection will reuse indent type (tabs/spaces)
          (cm.options.indentWithTabs ? insertTab : insertSoftTab)(cm);
        },
        showHelp: this.commands?.showHelp,
      });
      // these are active in all nav tabs
      cm.setOption('extraKeys', {
        Esc: 'cancel',
        F1: 'showHelp',
        'Ctrl-Space': 'autocomplete',
      });
      Object.assign(CodeMirror.keyMap.sublime, {
        'Shift-Ctrl-/': 'commentSelection',
      });
      // Differentiate regexps and templates, TODO: remove when implemented in CodeMirror
      const tokenizer = cm.doc.mode.token;
      Object.assign(cm.doc.mode, {
        token(stream, state) {
          const res = this::tokenizer(stream, state);
          return res === 'string-2' && state.jsState.lastType === 'regexp'
            ? 'string-2 regexp'
            : res;
        },
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
      const { cm, search } = this;
      if (!search.query || force) {
        const sel = cm.listSelections();
        // use the currently selected text if it's within one line
        if (sel?.length === 1 && sel[0].anchor.line === sel[0].head.line && !sel[0].empty()) {
          const query = cm.getSelection();
          search.queryFilled = !!query;
          search.query = query;
        }
        search.show = true;
      }
    },
    /** @param {VMSearchOptions} opts */
    doSearch(opts) {
      const { search } = this;
      search.hasResult = !search.query || !!this.doSearchInternal({ ...opts, wrapAround: true });
    },
    /**
     * @typedef {Object} VMSearchOptions
     * @property {boolean} [reversed]
     * @property {boolean} [wrapAround]
     * @property {boolean} [reuseCursor]
     * @property {{line:number,ch:number}} [pos]
     */
    /**
     * @param {VMSearchOptions} opts
     * @returns {?true}
     */
    doSearchInternal({ reversed, wrapAround, pos, reuseCursor } = {}) {
      const { cm, search } = this;
      const { caseSensitive, useRegex } = search.options;
      let retry = wrapAround ? 2 : 1;
      if (!pos || typeof pos === 'string') {
        pos = cm.getCursor(pos || (reversed ? 'from' : 'to'));
      }
      do {
        let cur;
        if (reuseCursor) {
          cur = search.cursor;
        } else {
          let { query } = search;
          if (useRegex) {
            try {
              query = new RegExp(query, caseSensitive ? '' : 'gi');
              search.error = null;
            } catch (err) {
              search.error = err;
              return;
            }
          }
          cur = cm.getSearchCursor(query, pos, { caseFold: !caseSensitive });
          search.cursor = cur;
        }
        while (cur.find(reversed)) {
          const from = cur.from();
          const to = cur.to();
          if (!cm.findMarks(from, to, m => m[PLACEHOLDER_SYM]).length) {
            this.reveal(from, to);
            cm.setSelection(from, to, { scroll: false });
            return true;
          }
        }
        retry -= 1;
        if (retry) {
          pos = {
            line: reversed ? cm.doc.size : 0,
            ch: 0,
          };
        }
      } while (retry);
    },
    find() {
      this.findFillQuery(true);
      this.doSearch({ pos: 'from' });
      this.$nextTick(() => {
        const { search } = this.$refs;
        search.select();
        search.focus();
      });
    },
    findNext(reversed) {
      const refocus = !this.search.query || !this.cm.hasFocus();
      this.findFillQuery();
      this.doSearch({ reversed });
      if (refocus) this.$nextTick(() => this.$refs.search.focus());
    },
    clearSearch() {
      this.search.show = false;
      this.cm.focus();
    },
    replace(all) {
      const { cm, search } = this;
      const { replace, query } = search;
      if (!query || !search.show) {
        search.show = true;
        this.find();
        return;
      }
      if (all) {
        cm.operation(() => {
          let opts = { pos: { line: 0, ch: 0 } };
          while (this.doSearchInternal(opts)) {
            search.cursor.replace(replace);
            opts = { reuseCursor: true };
          }
        });
      } else {
        const { sel } = cm.doc;
        this.doSearch({ pos: 'from' });
        if (sel.somethingSelected() && sel.equals(cm.doc.sel)) {
          cm.replaceSelection(replace);
          this.doSearch();
        }
      }
    },
    /** Centers the selection if it's outside of viewport so the surrounding context is visible */
    reveal(from, to) {
      const { cm } = this;
      const vpm = cm.options.viewportMargin;
      const { viewFrom, viewTo } = cm.display;
      const inView = from.line >= viewFrom + vpm
        && (to.line < viewTo - Math.min(cm.doc.size - viewTo, vpm));
      cm.scrollIntoView({ from, to },
        inView ? cm.defaultTextHeight() * 2 : cm.display.wrapper.clientHeight / 2);
    },
    goToLine() {
      const { cm, search, jumpPos } = this;
      let [line, ch] = jumpPos.split(':').map(Number) || [];
      if (line) {
        line -= 1;
        ch = ch ? ch - 1 : 0;
        cm.operation(() => {
          this.reveal({ line, ch }, { line, ch });
          cm.setCursor(line, ch, { scroll: false });
        });
        search.show = false;
        cm.focus();
      }
    },
    onCopy(e) {
      // CM already prepared the correct text in DOM selection, which is particularly
      // important when using its lineWiseCopyCut option (on by default)
      const sel = `${window.getSelection()}` || this.cm?.getSelection();
      if (!sel) return;
      const text = this.getRealContent(sel);
      e.clipboardData.setData('text', text);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    getRealContent(text = this.cm.getValue()) {
      return text.replace(CTRL_RE, (_, id) => this.placeholders.get(+id)?.body || '');
    },
    expandKeyMap(res, ...maps) {
      if (!res) {
        const { keyMap, extraKeys } = this.cm.options;
        maps = [extraKeys, keyMap];
        res = {};
      }
      maps.forEach((map) => {
        if (typeof map === 'string') map = CodeMirror.keyMap[map];
        map::forEachEntry(([key, value]) => {
          if (!res[key] && /^[a-z]+$/i.test(value) && CodeMirror.commands[value]) {
            res[key] = value;
          }
        });
        if (map.fallthrough) this.expandKeyMap(res, map.fallthrough);
      });
      delete res.fallthrough;
      return res;
    },
  },
  mounted() {
    let userOpts = options.get('editor');
    const theme = options.get('editorThemeName');
    const internalOpts = this.cmOptions || {};
    const opts = {
      ...cmDefaults,
      ...userOpts,
      ...theme && { theme },
      ...internalOpts, // internal options passed via `props` have the highest priority
      mode: this.mode || cmDefaults.mode,
    };
    CodeMirror.registerHelper('hint', 'autoHintWithFallback', (cm, ...args) => {
      const result = cm.getHelper(cm.getCursor(), 'hint')?.(cm, ...args);
      // fallback to anyword if default returns nothing (or no default)
      return result?.list.length ? result : CodeMirror.hint.anyword(cm, ...args);
    });
    this.initialize(CodeMirror(this.$refs.code, opts));
    this.expandKeyMap()::forEachEntry(([key, cmd]) => {
      const tt = this.tooltip[cmd];
      if (tt != null) this.tooltip[cmd] += `${tt ? ', ' : ''}${key}`;
    });
    // pressing Tab key inside a line with no selection will reuse indent size
    if (!opts.tabSize) this.cm.options.tabSize = this.cm.options.indentUnit;
    this.$refs.code.addEventListener('copy', this.onCopy);
    this.onActive(true);
    hookSetting('editor', (newUserOpts) => {
      // Use defaults for keys that were present in the old userOpts but got deleted in newUserOpts
      ({ ...cmDefaults, ...newUserOpts })::forEachEntry(([key, val]) => {
        if ((key in newUserOpts || key in userOpts)
        && !(key in internalOpts)
        && !deepEqual(this.cm.getOption(key), val)) {
          this.cm.setOption(key, val);
        }
      });
      userOpts = newUserOpts;
    });
    storage.base.getOne('editorSearch').then(prev => {
      const { search } = this;
      const saveSearchLater = debounce(() => {
        storage.base.set('editorSearch', objectPick(search, ['query', 'replace', 'options']));
      }, 500);
      const searchAgain = () => {
        saveSearchLater();
        this.doSearch({ pos: 'from' });
      };
      if (prev) Object.assign(search, prev);
      this.$watch('search.query', () => {
        if (!search.queryFilled) searchAgain();
        else search.queryFilled = null;
      });
      this.$watch('search.options', searchAgain, { deep: true });
      this.$watch('search.replace', saveSearchLater);
    });
    hookSetting('editorThemeName', val => {
      if (val != null && val !== this.cm.options.theme) {
        this.cm.setOption('theme', val);
      }
    });
  },
  beforeDestroy() {
    this.onActive(false);
  },
};
</script>

<style>
$selectionBg: #d7d4f0; /* copied from codemirror.css */
$selectionDarkBg: rgba(80, 75, 65, .99);

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
  .is-error, .is-error:focus {
    border-color: #e85600;
    background: #e8560010;
  }
}

.too-long-placeholder {
  font-style: italic;
}

/* CodeMirror show-hints fix to work here */
.CodeMirror-hints {
  z-index: 9999;
}

/* fix contenteditable selection color bug */
.CodeMirror .CodeMirror-line {
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
div.CodeMirror span.CodeMirror-matchingbracket { /* the same selector used in codemirror.css */
  color: unset;
  background-color: hsla(102, 80%, 50%, 0.3);
}
.cm-s-default {
  .cm-comment {
    color: #918982;
  }
  .cm-string-2 { // template literal: `example`
    color: #870;
  }
  .cm-string-2.cm-regexp {
    color: #d60;
  }
}

@media (prefers-color-scheme: dark) {
  .cm-matchhighlight {
    background-color: hsla(40, 100%, 50%, 0.1);
    border-bottom-color: hsla(40, 100%, 50%, 0.25);
  }
  .CodeMirror-hints {
    background: var(--bg);
  }
  .CodeMirror-hint {
    color: var(--fg);
  }
  li.CodeMirror-hint-active {
    background: var(--fg);
    color: var(--bg);
  }
  .CodeMirror {
    color: var(--fg);
    background: var(--bg);
    & &-scrollbar-filler,
    & &-gutter-filler {
      background: none;
    }
    & &-gutters {
      border-color: var(--fill-2);
      background-color: var(--fill-0-5);
    }
    & &-selected {
      background: $selectionDarkBg;
    }
    & &-line {
      ::selection {
        background: $selectionDarkBg;
      }
      /* must be used separately otherwise the entire rule is ignored in Chrome */
      ::-moz-selection {
        background: $selectionDarkBg;
      }
    }
    & &-guttermarker {
      color: white;
      &-subtle {
        color: #d0d0d0;
      }
    }
    & &-linenumber {
      color: #666;
    }
    & &-cursor {
      border-color: #f8f8f0;
    }
    & &-activeline-background {
      background: #1a1a1a;
    }
    & &-matchingbracket {
      outline: none;
      background: #444;
      color: yellow !important;
    }
  }
  .cm-s-default {
    // mostly copied from Monokai theme
    .cm-comment {
      color: #75715e;
    }
    .cm-atom {
      color: #ae81ff;
    }
    .cm-number {
      color: #ae81ff;
    }
    .cm-comment.cm-attribute {
      color: #97b757;
    }
    .cm-comment.cm-def {
      color: #bc9262;
    }
    .cm-comment.cm-tag {
      color: #bc6283;
    }
    .cm-comment.cm-type {
      color: #5998a6;
    }
    .cm-property,
    .cm-attribute {
      color: #a6e22e;
    }
    .cm-keyword {
      color: #f92672;
    }
    .cm-builtin {
      color: #66d9ef;
    }
    .cm-string {
      color: #e6db74;
    }
    .cm-string-2 {
      color: #bcb149;
    }
    .cm-string-2.cm-regexp {
      color: #ff00f7;
    }
    .cm-variable {
      color: #f8f8f2;
    }
    .cm-variable-2 {
      color: #9effff;
    }
    .cm-variable-3,
    .cm-type {
      color: #66d9ef;
    }
    .cm-def {
      color: #fd971f;
    }
    .cm-bracket {
      color: #f8f8f2;
    }
    .cm-tag {
      color: #f92672;
    }
    .cm-header {
      color: #ae81ff;
    }
    .cm-link {
      color: #ae81ff;
    }
    .cm-error {
      color: #f8f8f0;
      background: #f92672;
    }
    .cm-operator {
      color: #999
    }
  }
}
</style>
