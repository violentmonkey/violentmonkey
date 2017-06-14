<template>
  <div class="edit flex flex-col fixed-full">
    <div class="flex edit-header">
      <h2 v-text="i18n('labelScriptEditor')"></h2>
      <div class="flex-auto pos-rel px-2">
        <div class="edit-nav">
          <div v-text="i18n('editNavCode')" :class="{active: nav === 'code'}" @click="nav = 'code'"></div>
          <div v-text="i18n('editNavSettings')" :class="{active: nav === 'settings'}" @click="nav = 'settings'"></div>
        </div>
      </div>
      <div class="buttons">
        <a class="mr-1" href="https://violentmonkey.github.io/2017/03/14/How-to-edit-scripts-with-your-favorite-editor/" target="_blank">How to edit with your favorite editor?</a>
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code
        v-show="nav === 'code'" class="abs-full"
        v-model="code" :commands="commands" @ready="initEditor"
      />
      <vm-settings
        v-show="nav === 'settings'" class="abs-full"
        :value="value" :settings="settings"
      />
    </div>
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
      <form class="inline-block mr-1" @submit.prevent="replace()">
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
    <div class="frame-block">
      <div class="pull-right">
        <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"></button>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"></button>
        <button v-text="i18n('buttonClose')" @click="close"></button>
      </div>
    </div>
  </div>
</template>

<script>
import CodeMirror from 'codemirror';
import { i18n, debounce, sendMessage, noop } from 'src/common';
import { showMessage } from '../../utils';
import VmCode from '../code';
import VmSettings from './settings';
import Tooltip from '../tooltip';

function fromList(list) {
  return (list || []).join('\n');
}
function toList(text) {
  return text.split('\n')
  .map(line => line.trim())
  .filter(Boolean);
}
function findNext(cm, state, reversed) {
  cm.operation(() => {
    const query = state.query || '';
    let cursor = cm.getSearchCursor(query, reversed ? state.posFrom : state.posTo);
    if (!cursor.find(reversed)) {
      cursor = cm.getSearchCursor(query,
        reversed ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0));
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
  props: ['value'],
  components: {
    VmCode,
    VmSettings,
    Tooltip,
  },
  data() {
    this.debouncedFind = debounce(this.doFind, 100);
    return {
      nav: 'code',
      canSave: false,
      code: '',
      settings: {},
      search: {
        show: false,
        state: {
          query: null,
          replace: null,
        },
      },
      commands: {
        save: this.save,
        cancel: () => {
          if (this.search.show) {
            this.clearSearch();
          } else {
            this.close();
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
      },
    };
  },
  watch: {
    code() {
      this.canSave = true;
    },
    settings: {
      deep: true,
      handler() {
        this.canSave = true;
      },
    },
    'search.state.query'() {
      this.debouncedFind();
    },
  },
  mounted() {
    this.bindKeys();
    (this.value.id ? sendMessage({
      cmd: 'GetScript',
      data: this.value.id,
    }) : Promise.resolve(this.value))
    .then(script => {
      const settings = {};
      settings.more = {
        update: script.update,
      };
      this.code = script.code;
      const { custom } = script;
      settings.custom = [
        'name',
        'homepageURL',
        'updateURL',
        'downloadURL',
        'origInclude',
        'origExclude',
        'origMatch',
        'origExcludeMatch',
      ].reduce((value, key) => {
        value[key] = custom[key];
        return value;
      }, {
        include: fromList(custom.include),
        match: fromList(custom.match),
        exclude: fromList(custom.exclude),
        excludeMatch: fromList(custom.excludeMatch),
        runAt: custom.runAt || custom['run-at'] || '',
      });
      this.settings = settings;
      this.$nextTick(() => {
        this.canSave = false;
      });
    });
  },
  beforeDestroy() {
    this.unbindKeys();
  },
  methods: {
    save() {
      const { settings: { custom, more } } = this;
      const value = [
        'name',
        'runAt',
        'homepageURL',
        'updateURL',
        'downloadURL',
        'origInclude',
        'origExclude',
        'origMatch',
        'origExcludeMatch',
      ].reduce((val, key) => {
        val[key] = custom[key];
        return val;
      }, {
        include: toList(custom.include),
        match: toList(custom.match),
        exclude: toList(custom.exclude),
        excludeMatch: toList(custom.excludeMatch),
      });
      return sendMessage({
        cmd: 'ParseScript',
        data: {
          id: this.value.id,
          code: this.code,
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts,
          // otherwise the script with same namespace will be overridden
          isNew: !this.value.id,
          message: '',
          custom: value,
          more,
        },
      })
      .then(script => {
        this.$emit('input', script);
        this.canSave = false;
      }, err => {
        showMessage({ text: err });
      });
    },
    close() {
      (this.canSave ? Promise.reject() : Promise.resolve())
      .catch(() => new Promise((resolve, reject) => {
        showMessage({
          input: false,
          text: i18n('confirmNotSaved'),
          buttons: [
            {
              text: i18n('buttonOK'),
              onClick: resolve,
            },
            {
              text: i18n('buttonCancel'),
              onClick: reject,
            },
          ],
          onBackdropClick: reject,
        });
      }))
      .then(() => this.$emit('close'), noop);
    },
    saveClose() {
      this.save().then(this.close);
    },
    initEditor(cm) {
      this.cm = cm;
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
    onKeyDown(e) {
      const { cm } = this;
      if (!cm) return;
      const name = CodeMirror.keyName(e);
      const commands = [
        'cancel',
        'find',
        'findNext',
        'findPrev',
        'replace',
        'replaceAll',
      ];
      [
        cm.options.extraKeys,
        cm.options.keyMap,
      ].some((keyMap) => {
        let stop = false;
        if (keyMap) {
          CodeMirror.lookupKey(name, keyMap, (b) => {
            if (commands.includes(b)) {
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
    bindKeys() {
      window.addEventListener('keydown', this.onKeyDown, false);
    },
    unbindKeys() {
      window.removeEventListener('keydown', this.onKeyDown, false);
    },
    goToLine() {
      const line = this.search.line - 1;
      const { cm } = this;
      if (!isNaN(line)) cm.setCursor(line, 0);
      cm.focus();
    },
  },
};
</script>

<style>
.edit {
  &-header {
    > * {
      padding: 8px;
      cursor: pointer;
    }
  }
  &-nav {
    position: absolute;
    left: 0;
    bottom: 0;
    > div {
      display: inline-block;
      padding: 8px 16px;
      border-top-left-radius: 6px;
      border-top-right-radius: 6px;
      color: #bbb;
      &.active {
        background: white;
        box-shadow: 0 -1px 1px #bbb;
        color: #333;
      }
      &:hover {
        box-shadow: 0 -1px 1px #bbb;
      }
    }
  }
}
</style>
