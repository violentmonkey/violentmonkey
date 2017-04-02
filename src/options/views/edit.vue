<template>
  <div class="edit flex flex-col fixed-full">
    <div class="frame-block">
      <div class="buttons pull-right">
        <a class="mr-1" href="https://violentmonkey.github.io/2017/03/14/How-to-edit-scripts-with-your-favorite-editor/" target="_blank">How to edit locally?</a>
        <div v-dropdown>
          <button dropdown-toggle v-text="i18n('buttonCustomMeta')"></button>
          <div class="dropdown-menu">
            <table>
              <tr>
                <td title="@name" v-text="i18n('labelName')"></td>
                <td class="expand">
                  <input type="text" v-model="custom.name" :placeholder="placeholders.name">
                </td>
                <td title="@run-at" v-text="i18n('labelRunAt')"></td>
                <td>
                  <select v-model="custom['run-at']">
                    <option value="" v-text="i18n('labelRunAtDefault')"></option>
                    <option value=start>document-start</option>
                    <option value=idle>document-idle</option>
                    <option value=end>document-end</option>
                  </select>
                </td>
              </tr>
              <tr title="@homepageURL">
                <td v-text="i18n('labelHomepageURL')"></td>
                <td colspan=3 class=expand>
                  <input type="text" v-model="custom.homepageURL" :placeholder="placeholders.homepageURL">
                </td>
              </tr>
            </table>
            <table>
              <tr title="@updateURL">
                <td v-text="i18n('labelUpdateURL')"></td>
                <td class=expand>
                  <input type="text" v-model="custom.updateURL" :placeholder="placeholders.updateURL">
                </td>
              </tr>
              <tr title="@downloadURL">
                <td v-text="i18n('labelDownloadURL')"></td>
                <td class=expand>
                  <input type="text" v-model="custom.downloadURL" :placeholder="placeholders.downloadURL">
                </td>
              </tr>
            </table>
            <fieldset title="@include">
              <legend>
                <span v-text="i18n('labelInclude')"></span>
                <label>
                  <input type=checkbox v-model="custom.keepInclude">
                  <span v-text="i18n('labelKeepInclude')"></span>
                </label>
              </legend>
              <div v-html="i18n('labelCustomInclude')"></div>
              <textarea v-model="custom.include"></textarea>
            </fieldset>
            <fieldset title="@match">
              <legend>
                <span v-text="i18n('labelMatch')"></span>
                <label>
                  <input type=checkbox v-model="custom.keepMatch">
                  <span v-text="i18n('labelKeepMatch')"></span>
                </label>
              </legend>
              <div v-html="i18n('labelCustomMatch')"></div>
              <textarea v-model="custom.match"></textarea>
            </fieldset>
            <fieldset title="@exclude">
              <legend>
                <span v-text="i18n('labelExclude')"></span>
                <label>
                  <input type=checkbox v-model="custom.keepExclude">
                  <span v-text="i18n('labelKeepExclude')"></span>
                </label>
              </legend>
              <div v-html="i18n('labelCustomExclude')"></div>
              <textarea v-model="custom.exclude"></textarea>
            </fieldset>
          </div>
        </div>
      </div>
      <h2 v-text="i18n('labelScriptEditor')"></h2>
    </div>
    <div class="frame-block flex-auto p-rel">
      <vm-code
      class="abs-full"
      :content="code" :commands="commands"
      @change="contentChange" @ready="initEditor"
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
        <input ref="search" v-model="search.state.query" title="Ctrl-F">
        <button type="button" @click="findNext(1)" title="Shift-Ctrl-G">&lt;</button>
        <button type="submit" title="Ctrl-G">&gt;</button>
      </form>
      <form class="inline-block mr-1" @submit.prevent="replace()">
        <span v-text="i18n('labelReplace')"></span>
        <input v-model="search.state.replace">
        <button type="submit" v-text="i18n('buttonReplace')" title="Shift-Ctrl-F"></button>
        <button type="button" v-text="i18n('buttonReplaceAll')" @click="replace(1)" title="Shift-Ctrl-R"></button>
      </form>
    </div>
    <div class="frame-block">
      <div class="pull-right">
        <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"></button>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"></button>
        <button v-text="i18n('buttonClose')" @click="close"></button>
      </div>
      <label>
        <input type=checkbox v-model="update">
        <span v-text="i18n('labelAllowUpdate')"></span>
      </label>
    </div>
  </div>
</template>

<script>
import CodeMirror from 'codemirror';
import { i18n, debounce, sendMessage, noop } from 'src/common';
import { showMessage } from '../utils';
import VmCode from './code';

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
  props: ['script'],
  components: {
    VmCode,
  },
  data() {
    this.debouncedFind = debounce(this.find, 100);
    return {
      canSave: false,
      update: false,
      code: '',
      custom: {},
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
  computed: {
    placeholders() {
      const { script } = this;
      return {
        name: script.meta.name,
        homepageURL: script.meta.homepageURL,
        updateURL: script.meta.updateURL || i18n('hintUseDownloadURL'),
        downloadURL: script.meta.downloadURL || script.lastInstallURL,
      };
    },
  },
  watch: {
    custom: {
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
    (this.script.id ? sendMessage({
      cmd: 'GetScript',
      data: this.script.id,
    }) : Promise.resolve(this.script))
    .then((script) => {
      this.update = script.update;
      this.code = script.code;
      const { custom } = script;
      this.custom = [
        'name',
        'homepageURL',
        'updateURL',
        'downloadURL',
      ].reduce((value, key) => {
        value[key] = custom[key];
        return value;
      }, {
        keepInclude: custom._include !== false,
        keepMatch: custom._match !== false,
        keepExclude: custom._exclude !== false,
        include: fromList(custom.include),
        match: fromList(custom.match),
        exclude: fromList(custom.exclude),
        'run-at': custom['run-at'] || '',
      });
      this.$nextTick(() => {
        this.canSave = false;
      });
    });
  },
  beforeDestroy() {
    if (this.cm) this.unbindKeys();
  },
  methods: {
    save() {
      const { custom } = this;
      const value = [
        'name',
        'run-at',
        'homepageURL',
        'updateURL',
        'downloadURL',
      ].reduce((val, key) => {
        val[key] = custom[key];
        return val;
      }, {
        _include: custom.keepInclude,
        _match: custom.keepMatch,
        _exclude: custom.keepExclude,
        include: toList(custom.include),
        match: toList(custom.match),
        exclude: toList(custom.exclude),
      });
      return sendMessage({
        cmd: 'ParseScript',
        data: {
          id: this.script.id,
          code: this.code,
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts
          isNew: !this.script.id,
          message: '',
          more: {
            custom: value,
            update: this.update,
          },
        },
      })
      .then((script) => {
        this.script = script;
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
              text: 'OK',
              onClick: resolve,
            },
            {
              text: 'Cancel',
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
    contentChange(code) {
      this.code = code;
      this.canSave = true;
    },
    initEditor(cm) {
      this.cm = cm;
      this.bindKeys();
    },
    find() {
      const { state } = this.search;
      state.posTo = state.posFrom;
      this.findNext();
    },
    findNext(reversed) {
      const { state } = this.search;
      const { cm } = this;
      if (state.query) {
        findNext(cm, state, reversed);
      }
      this.search.show = true;
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
