<template>
  <div class="edit-values" ref="container" :data-editing="current && ''">
    <div class="mb-1">
      <button @click="onNew" v-if="!readOnly">+</button>
      <div class="inline-block ml-2" v-if="totalPages > 1">
        <button :disabled="page === 1" @click="page -= 1">&larr;</button>
        <span class="ml-1" v-text="page"/> / <span class="mr-1" v-text="totalPages"/>
        <button :disabled="page >= totalPages" @click="page += 1">&rarr;</button>
      </div>
      <span class="ml-2 mr-2c">
        <span>
          <template v-if="totalPages > 1">
            <kbd>PageUp</kbd>, <kbd>PageDown</kbd>,
          </template>
          <kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Tab</kbd>, <kbd>Shift-Tab</kbd>,
        </span>
        <span><kbd>Enter</kbd>: {{i18n('buttonEdit')}},</span>
        <span><kbd>Ctrl-Del</kbd>: {{i18n('buttonRemove')}}</span>
      </span>
    </div>
    <div class="edit-values-table main"
         @keydown.down.exact="onUpDown"
         @keydown.up.exact="onUpDown">
      <a
        ref="editAll"
        class="edit-values-row flex"
        @click="onEditAll" tabindex="0" v-text="i18n('editValueAllHint')"/>
      <div
        v-for="key in pageKeys"
        :key="key"
        class="edit-values-row flex monospace-font"
        @keydown.delete.ctrl.exact="onRemove(key)"
        @click="onEdit(key)">
        <div class="ellipsis">
          <a v-text="key" tabindex="0"/>
        </div>
        <div class="ellipsis flex-auto" v-text="getValue(key, true)"></div>
        <pre v-text="getLength(key)"/>
        <div class="del" @click.stop="onRemove(key)">
          <icon name="trash"/>
        </div>
      </div>
    </div>
    <h3 v-text="i18n('headerRecycleBin')" v-if="trash"/>
    <div class="edit-values-table trash monospace-font"
         @keydown.down.exact="onUpDown"
         @keydown.up.exact="onUpDown"
         v-if="trash">
      <!-- eslint-disable-next-line vue/no-unused-vars -->
      <div v-for="({ key, cut, len }, trashKey) in trash" :key="trashKey"
           class="edit-values-row flex"
           @click="onRestore(trashKey)">
        <a class="ellipsis" v-text="key" tabindex="0"/>
        <s class="ellipsis flex-auto" v-text="cut"/>
        <pre v-text="len"/>
      </div>
    </div>
    <div class="edit-values-empty mt-1" v-if="!loading && !keys.length" v-text="i18n('noValues')"/>
    <div class="edit-values-panel flex flex-col mb-1c" v-if="current">
      <div class="control">
        <h4 v-text="current.isAll ? i18n('labelEditValueAll') : i18n('labelEditValue')"/>
        <div>
          <button v-for="(text, idx) in [i18n('buttonOK'), i18n('buttonApply')]" :key="text"
                  v-text="text" @click="onSave(idx)"
                  :class="{'has-error': current.error, 'save-beacon': !idx}"
                  :title="current.error"
                  :disabled="current.error || !current.dirty"/>
          <button v-text="i18n('buttonCancel')" @click="onCancel"></button>
        </div>
      </div>
      <label v-show="!current.isAll">
        <span v-text="i18n('valueLabelKey')"/>
        <input type="text" v-model="current.key" :readOnly="!current.isNew || readOnly"
               ref="key"
               spellcheck="false"
               @keydown.esc.exact.stop="onCancel">
      </label>
      <label>
        <span v-text="current.isAll ? i18n('valueLabelValueAll') : i18n('valueLabelValue')"/>
        <!-- TODO: use CodeMirror in json mode -->
        <vm-code
          :value="current.value"
          ref="value"
          class="h-100 mt-1"
          mode="application/json"
          :readOnly="readOnly"
          @code-dirty="onChange"
          :commands="{ close: onCancel, save: onSave }"
        />
      </label>
    </div>
  </div>
</template>

<script>
import { dumpScriptValue, formatByteLength, isEmpty, sendCmdDirectly } from '@/common';
import { handleTabNavigation, keyboardService } from '@/common/keyboard';
import { deepCopy, deepEqual, mapEntry } from '@/common/object';
import { WATCH_STORAGE } from '@/common/consts';
import VmCode from '@/common/ui/code';
import Icon from '@/common/ui/icon';
import { showMessage } from '@/common/ui';
import { store } from '../../utils';

const PAGE_SIZE = 25;
const MAX_LENGTH = 1024;
const MAX_JSON_DURATION = 10; // ms
let focusedElement;
const currentObservables = { error: '', dirty: false };
const cutLength = s => (s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH) : s);
const reparseJson = (str) => {
  try {
    return JSON.stringify(JSON.parse(str), null, '  ');
  } catch (e) {
    // This shouldn't happen but the storage may get corrupted or modified directly
    return str;
  }
};
const getActiveElement = () => document.activeElement;
const flipPage = (vm, dir) => {
  vm.page = Math.max(1, Math.min(vm.totalPages, vm.page + dir));
};
/** Uses a negative tabId which is recognized in bg::values.js */
const fakeSender = () => ({ tab: { id: Math.random() - 2 }, frameId: 0 });
const conditionNotEdit = { condition: '!edit' };

export default {
  props: ['active', 'script', 'readOnly'],
  components: {
    Icon,
    VmCode,
  },
  data() {
    return {
      current: null,
      loading: true,
      page: null,
      values: null,
      trash: null,
    };
  },
  computed: {
    keys() {
      return Object.keys(this.values || {}).sort();
    },
    totalPages() {
      return Math.ceil(this.keys.length / PAGE_SIZE);
    },
    pageKeys() {
      const offset = PAGE_SIZE * (this.page - 1);
      return this.keys.slice(offset, offset + PAGE_SIZE);
    },
  },
  mounted() {
    this.$refs.container.addEventListener('focusin', evt => {
      keyboardService.setContext('edit', 'selectionEnd' in evt.target);
    });
  },
  watch: {
    active(val) {
      const id = this.script.props.id;
      if (val) {
        (this.current ? this.cm : focusedElement)?.focus();
        sendCmdDirectly('GetValueStore', id, undefined, this.sender = fakeSender()).then(data => {
          const isFirstTime = !this.values;
          if (this.setData(data) && isFirstTime && this.keys.length) {
            this.autofocus(true);
          }
          this.loading = false;
        });
        this.disposeList = [
          keyboardService.register('pageup', () => flipPage(this, -1), conditionNotEdit),
          keyboardService.register('pagedown', () => flipPage(this, 1), conditionNotEdit),
        ];
      } else {
        this.disposeList?.forEach(dispose => dispose());
      }
      // toggle storage watcher
      if (val) {
        const fn = this.onStorageChanged;
        const bg = browser.extension.getBackgroundPage();
        this[WATCH_STORAGE] = browser.runtime.connect({
          name: WATCH_STORAGE + JSON.stringify({
            cfg: { value: id },
            id: bg?.[WATCH_STORAGE](fn),
            tabId: this.sender.tab.id,
          }),
        });
        if (!bg) this[WATCH_STORAGE].onMessage.addListener(fn);
      } else {
        this[WATCH_STORAGE]?.disconnect();
        this[WATCH_STORAGE] = null;
      }
    },
    current(val, oldVal) {
      if (val) {
        focusedElement = getActiveElement();
        this.$nextTick(() => {
          const refs = this.$refs;
          const vmCode = refs.value;
          const { cm } = vmCode;
          this.cm = cm;
          if (oldVal) {
            vmCode.updateValue(val.value); // focuses CM, which we may override in isNew below
          }
          if (val.isNew) {
            const el = refs.key;
            el.setSelectionRange(0, 0);
            el.focus();
          } else {
            cm.setCursor(0, 0);
            cm.focus();
          }
        });
      } else if (oldVal) {
        focusedElement?.focus();
      }
    },
    page() {
      focusedElement = null;
      this.autofocus();
    },
  },
  methods: {
    autofocus(andClick) {
      this.$nextTick(() => {
        this.$refs.editAll[andClick ? 'click' : 'focus']();
      });
    },
    getLength(key, raw) {
      // Showing length as key+val not "key" + : + "raw" to avoid confusing users
      const len = key.length + (this.values[key] || raw).length - 1;
      return len < 10_000 ? len : formatByteLength(len);
    },
    getValue(key, sliced, raw) {
      let value = this.values[key] || raw;
      const type = value[0];
      value = value.slice(1);
      if (type === 's') value = JSON.stringify(value);
      else if (!sliced) value = reparseJson(value);
      return sliced ? cutLength(value) : value;
    },
    getValueAll() {
      return `{\n  ${
        this.keys
        .map(key => `${JSON.stringify(key)}: ${this.getValue(key)}`)
        .join(',\n')
        .replace(/\n/g, '\n  ') // also handles nested linebreaks inside objects/arrays
      }\n}`;
    },
    setData(values = {}) {
      if (!deepEqual(this.values, values)) {
        this.values = values;
        this.page = Math.min(this.page, this.totalPages) || 1;
        this.calcSize();
        return true;
      }
    },
    calcSize() {
      store.storageSize = this.keys.reduce((sum, key) => sum
        + key.length + 4 + this.values[key].length + 2, 2);
    },
    updateValue({
      key,
      jsonValue,
      rawValue = dumpScriptValue(jsonValue) || '',
    }) {
      const { id } = this.script.props;
      return sendCmdDirectly('UpdateValue', { id, key, raw: rawValue }, undefined, this.sender)
      .then(() => {
        if (rawValue) {
          this.values[key] = rawValue;
        } else {
          delete this.values[key];
        }
        this.calcSize();
      });
    },
    onNew() {
      this.current = {
        isNew: true,
        key: '',
        value: '',
        ...currentObservables,
      };
    },
    async onRemove(key) {
      this.updateValue({ key });
      (this.trash || (this.trash = {}))[key + Math.random()] = {
        key,
        rawValue: this.values[key],
        cut: this.getValue(key, true),
        len: this.getLength(key),
      };
      if (this.current?.key === key) {
        this.current = null;
      }
    },
    onRestore(trashKey) {
      const { trash } = this;
      const { key, rawValue } = trash[trashKey];
      delete trash[trashKey];
      if (isEmpty(trash)) this.trash = null;
      this.updateValue({ key, rawValue });
    },
    onEdit(key) {
      this.current = {
        key,
        value: this.getValue(key),
        ...currentObservables,
      };
    },
    onEditAll() {
      this.current = {
        isAll: true,
        value: this.getValueAll(),
        ...currentObservables,
      };
    },
    async onSave(buttonIndex) {
      const { cm, current } = this;
      if (current.jsonPaused) {
        current.jsonPaused = false;
        this.onChange();
      }
      if (current.error) {
        const pos = current.errorPos;
        cm.setSelection(pos, { line: pos.line, ch: pos.ch + 1 });
        cm.focus();
        showMessage({ text: current.error });
        return;
      }
      if (buttonIndex === 1) {
        cm.markClean();
        current.dirty = false;
      } else {
        this.current = null;
      }
      if (current.isAll) {
        await sendCmdDirectly('SetValueStores', {
          [this.script.props.id]: current.jsonValue::mapEntry(val => dumpScriptValue(val) || ''),
        });
      } else {
        await this.updateValue(current);
      }
    },
    onCancel() {
      const cur = this.current;
      if (cur.dirty) {
        const key = `${cur.key} ${Math.random() * 1e9 | 0}`;
        const val = this.cm.getValue();
        const rawValue = dumpScriptValue(val);
        (this.trash || (this.trash = {}))[key] = {
          key,
          rawValue,
          cut: cutLength(val),
          len: this.getLength(key, rawValue),
        };
      }
      this.current = null;
    },
    onChange(isChanged) {
      const { current } = this;
      current.dirty = isChanged;
      current.error = null;
      if (current.jsonPaused) return;
      const { cm } = this;
      const t0 = performance.now();
      try {
        const str = cm.getValue();
        current.jsonValue = str.trim() ? JSON.parse(str) : undefined;
      } catch (e) {
        const re = /(position\s+)(\d+)|$/;
        const pos = cm.posFromIndex(+`${e}`.match(re)[2] || 0);
        current.error = `${e}`.replace(re, `$1${pos.line + 1}:${pos.ch + 1}`);
        current.errorPos = pos;
        current.jsonValue = undefined;
      }
      current.jsonPaused = performance.now() - t0 > MAX_JSON_DURATION;
    },
    onStorageChanged(changes) {
      const data = Object.values(changes)[0].newValue;
      if (data) {
        const { current } = this;
        const currentKey = current?.key;
        const valueGetter = current && (current.isAll ? this.getValueAll : this.getValue);
        this.setData(data instanceof Object ? data : deepCopy(data));
        if (current) {
          const newText = valueGetter(currentKey);
          const curText = this.cm.getValue();
          if (curText === newText) {
            current.isNew = false;
            current.dirty = false;
          } else if (!current.dirty) {
            // Updating the current value only if it wasn't yet changed by the user.
            // Keeping the same this.current to avoid triggering `watch` observer
            current.value = newText;
            this.onChange();
          }
        }
      } else {
        this.setData(data);
      }
    },
    onUpDown(evt) {
      handleTabNavigation(evt.key === 'ArrowDown' && 1
        || evt.target !== this.$refs.editAll && -1
        || 0); // Prevents Up from escaping the table since we don't listen for Down outside
    },
  },
};
</script>

<style>
$lightBorder: 1px solid var(--fill-2);
$editorWidth: 50%;
$editorGap: calc(100% - $editorWidth);

.edit-values {
  &[data-editing] {
    width: $editorGap; /* revealing trashcan icons */
  }
  &-row {
    border: $lightBorder;
    cursor: pointer;
    .main > &:first-child {
      padding: 8px 6px;
    }
    &:not(:first-child) {
      border-top: 0;
    }
    > * {
      font-size: 12px;
      padding: 4px 6px;
      &:first-child {
        position: relative;
        flex: 0 0 30%;
        max-width: 240px;
      }
      &:not(:first-child) {
        border-left: $lightBorder;
      }
    }
    pre {
      width: 5em;
      text-align: right;
    }
    &:focus,
    &:hover {
      background-color: var(--fill-0-5);
      a {
        text-decoration: underline;
      }
    }
    &:focus {
      text-decoration: underline;
    }
    &:focus .edit-values-btn,
    &:hover .edit-values-btn {
      display: block;
    }
    .del:active {
      color: #fff;
      background: red;
    }
  }
  &-empty {
    color: var(--fill-7);
  }
  &-panel {
    position: absolute;
    top: 0;
    right: 0;
    width: $editorWidth;
    height: 100%;
    padding: 8px;
    box-shadow: -5px 0 5px var(--fill-2);
    background: var(--bg);
    z-index: 10;
    @media (max-width: 767px) {
      width: 100%;
    }
    .control {
      display: flex;
      align-items: center;
      h4 {
        flex: auto;
        width: 0;
      }
    }
    input {
      width: 100%;
    }
    label {
      display: flex;
      flex-direction: column;
      &:last-child {
        flex: auto;
        height: 0;
      }
      > input {
        margin: .25em 0;
        padding: .25em;
      }
    }
  }
  .save-beacon:not([disabled]) {
    background-color: gold;
    color: #000;
  }
  .CodeMirror {
    border: $lightBorder;
  }
}
</style>
