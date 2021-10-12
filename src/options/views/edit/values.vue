<template>
  <div class="edit-values" ref="container">
    <div class="mb-1">
      <button @click="onNew">+</button>
      <tooltip :content="i18n('editValueAllHint')" align="left">
        <button @click="onEditAll" v-text="i18n('editValueAll')"/>
      </tooltip>
      <div class="inline-block ml-2" v-if="totalPages > 1">
        <button :disabled="page === 1" @click="page -= 1">&larr;</button>
        <span class="ml-1" v-text="page"/> / <span class="mr-1" v-text="totalPages"/>
        <button :disabled="page >= totalPages" @click="page += 1">&rarr;</button>
      </div>
      <span class="ml-2 mr-2c">
        <template v-if="totalPages > 1">
          <span><kbd>PageUp</kbd>: ←</span>
          <span><kbd>PageDown</kbd>: →</span>
        </template>
        <span><kbd>Tab</kbd>: ↓</span>
        <span><kbd>Shift-Tab</kbd>: ↑</span>
        <span><kbd>Enter</kbd>: {{i18n('buttonEdit')}}</span>
        <span><kbd>Ctrl-Del</kbd>: {{i18n('buttonRemove')}}</span>
      </span>
    </div>
    <div class="edit-values-table" v-if="keys">
      <div class="edit-values-empty" v-if="!keys.length">
        <div v-text="i18n('noValues')"></div>
      </div>
      <a
        v-for="key in pageKeys"
        :key="key"
        class="edit-values-row flex"
        tabindex="0"
        @keydown.delete.ctrl.exact="onRemove(key)"
        @click="onEdit(key)">
        <div class="ellipsis">
          <span v-text="key"></span>
          <div class="edit-values-btn" @click.stop.prevent="onRemove(key)">
            <icon name="trash"/>
          </div>
        </div>
        <div class="ellipsis flex-auto" v-text="getValue(key, true)"></div>
        <pre v-text="getLength(key)"/>
      </a>
    </div>
    <div class="edit-values-panel flex flex-col mb-1c" v-if="current">
      <div class="control">
        <h4 v-text="current.isAll ? i18n('labelEditValueAll') : i18n('labelEditValue')"/>
        <div>
          <button v-text="i18n('editValueSave')" @click="onSave"
                  :class="{'has-error': current.error}"
                  :title="current.error"
                  :disabled="current.error || current.value === initial"/>
          <button v-text="i18n('editValueCancel')" @click="onCancel"></button>
        </div>
      </div>
      <label v-show="!current.isAll">
        <span v-text="i18n('valueLabelKey')"/>
        <input type="text" v-model="current.key" :readOnly="!current.isNew"
               ref="key"
               spellcheck="false"
               @keydown.esc.exact.stop="onCancel">
      </label>
      <label>
        <span v-text="current.isAll ? i18n('valueLabelValueAll') : i18n('valueLabelValue')"/>
        <textarea v-model="current.value"
                  ref="value"
                  spellcheck="false"
                  @input="onChange"
                  @keydown.esc.exact.stop="onCancel"/>
      </label>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { dumpScriptValue, formatByteLength, sendCmdDirectly } from '#/common';
import { keyboardService } from '#/common/keyboard';
import { mapEntry } from '#/common/object';
import Icon from '#/common/ui/icon';
import storage from '#/common/storage';
import { showMessage } from '#/common/ui';
import { store } from '../../utils';

const PAGE_SIZE = 25;
const MAX_LENGTH = 1024;
const MAX_JSON_DURATION = 10; // ms
let scriptStorageKey;
let focusedElement;

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
  if (getActiveElement()?.selectionEnd == null) {
    vm.page = Math.max(1, Math.min(vm.totalPages, vm.page + dir));
  }
};

export default {
  props: ['active', 'script'],
  components: {
    Icon,
    Tooltip,
  },
  data() {
    return {
      current: null,
      keys: null,
      page: null,
      values: null,
    };
  },
  computed: {
    totalPages() {
      return Math.ceil(this.keys?.length / PAGE_SIZE) || 0;
    },
    pageKeys() {
      const offset = PAGE_SIZE * (this.page - 1);
      return this.keys?.slice(offset, offset + PAGE_SIZE);
    },
  },
  watch: {
    active(val) {
      if (val) {
        storage.value.getOne(this.script.props.id).then(data => {
          // Focusing explicitly when the values UI becomes active again
          if (this.page) this.autofocus();
          this.setData(data);
        });
        scriptStorageKey = storage.value.prefix + this.script?.props.id;
        this.disposeList = [
          keyboardService.register('pageup', () => flipPage(this, -1)),
          keyboardService.register('pagedown', () => flipPage(this, 1)),
        ];
      } else {
        this.disposeList?.forEach(dispose => dispose());
      }
      browser.storage.onChanged[`${val ? 'add' : 'remove'}Listener`](this.onStorageChanged);
    },
    current(val, oldVal) {
      if (val) {
        focusedElement = getActiveElement();
        this.initial = val.value;
        this.$nextTick(() => {
          const el = this.$refs[val.isNew ? 'key' : 'value'];
          el.setSelectionRange(0, 0);
          el.focus();
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
    autofocus() {
      this.$nextTick(() => {
        (focusedElement || this.$refs.container.querySelector(this.keys?.length ? 'a' : 'button'))
        .focus();
      });
    },
    getLength(key) {
      const len = this.values[key].length - 1;
      return len < 10_000 ? len : formatByteLength(len);
    },
    getValue(key, sliced) {
      let value = this.values[key];
      const type = value[0];
      value = value.slice(1);
      if (type === 's') value = JSON.stringify(value);
      else if (!sliced) value = reparseJson(value);
      if (sliced && value.length > MAX_LENGTH) {
        value = value.slice(0, MAX_LENGTH);
      }
      return value;
    },
    setData(values = {}) {
      this.values = values;
      this.keys = Object.keys(values).sort();
      this.page = Math.min(this.page, this.totalPages) || 1;
      this.calcSize();
    },
    calcSize() {
      store.storageSize = this.keys.reduce((sum, key) => sum + this.values[key].length - 1, 0);
    },
    updateValue({ key, jsonValue, isNew }) {
      const rawValue = dumpScriptValue(jsonValue) || '';
      const { id } = this.script.props;
      return sendCmdDirectly('UpdateValue', { id, key, value: rawValue })
      .then(() => {
        if (rawValue) {
          this.$set(this.values, key, rawValue);
          if (isNew) this.keys.push(key);
        } else {
          const i = this.keys.indexOf(key);
          if (i >= 0) this.keys.splice(i, 1);
          this.$delete(this.values, key);
        }
        this.calcSize();
      });
    },
    onNew() {
      this.current = {
        isNew: true,
        key: '',
        value: '',
      };
    },
    onRemove(key) {
      this.updateValue({ key })
      .then(() => {
        if (this.current && this.current.key === key) {
          this.current = null;
        }
      });
    },
    onEdit(key) {
      this.current = {
        isNew: false,
        key,
        value: this.getValue(key),
      };
    },
    onEditAll() {
      this.current = {
        isAll: true,
        value: `{\n  ${
          this.keys
          .map(key => `${JSON.stringify(key)}: ${this.getValue(key)}`)
          .join(',\n')
          .replace(/\n/g, '\n  ') // also handles nested linebreaks inside objects/arrays
        }\n}`,
      };
    },
    async onSave() {
      const { current } = this;
      if (current.jsonPaused) {
        current.jsonPaused = false;
        this.onChange();
      }
      if (current.error) {
        const pos = +current.error.match(/position\s+(\d+)|$/)[1] || 0;
        this.$refs.value.setSelectionRange(pos, pos + 1);
        this.$refs.value.focus();
        showMessage({ text: current.error });
        return;
      }
      this.current = null;
      if (current.isAll) {
        await sendCmdDirectly('SetValueStores', [{
          where: {
            id: this.script.props.id,
          },
          store: current.jsonValue::mapEntry(([, val]) => dumpScriptValue(val) || ''),
        }]);
      } else {
        await this.updateValue(current);
      }
    },
    onCancel() {
      this.current = null;
    },
    onChange() {
      const { current } = this;
      current.error = null;
      if (current.jsonPaused) return;
      const t0 = performance.now();
      const str = current.value.trim();
      try {
        current.jsonValue = str ? JSON.parse(str) : undefined;
      } catch (e) {
        current.error = e.message || e;
        current.jsonValue = undefined;
      }
      current.jsonPaused = performance.now() - t0 > MAX_JSON_DURATION;
    },
    onStorageChanged(changes) {
      const data = changes[scriptStorageKey]?.newValue;
      if (data) {
        const { current } = this;
        const oldText = current && this.getValue(current.key);
        this.setData(data);
        if (current) {
          const newText = this.getValue(current.key);
          const curText = current.value;
          if (curText === newText) {
            current.isNew = false;
          } else if (curText === oldText) {
            // Updating the current value only if it wasn't yet changed by the user.
            // Keeping the same this.current to avoid triggering `watch` observer
            Object.keys(current)
            .filter(k => k !== 'key' && k !== 'value')
            .forEach(k => delete current[k]);
            current.value = newText;
          }
        }
      } else {
        store.storageSize = 0;
      }
    },
  },
};
</script>

<style>
.edit-values {
  &-row {
    border: 1px solid var(--fill-2);
    color: unset;
    cursor: pointer;
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
        border-left: 1px solid var(--fill-2);
      }
    }
    pre {
      width: 5em;
      text-align: right;
    }
    &:focus,
    &:hover {
      background-color: var(--fill-0-5);
    }
    &:focus {
      text-decoration: underline;
    }
    &:focus .edit-values-btn,
    &:hover .edit-values-btn {
      display: block;
    }
  }
  &-empty {
    color: var(--fill-7);
  }
  &-panel {
    position: absolute;
    top: 0;
    right: 0;
    width: 50%;
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
      &:last-child,
      &:last-child textarea {
        flex: auto;
        height: 0;
      }
      > textarea, input {
        margin: .25em 0;
        padding: .25em;
      }
    }
    textarea {
      width: 100%;
      word-break: break-all;
      resize: none;
    }
  }
  &-btn {
    position: absolute;
    top: 0;
    right: 0;
    padding: 4px;
    background: inherit;
    box-shadow: 0 0 5px 5px var(--fill-0-5);
    display: none;
  }
}
</style>
