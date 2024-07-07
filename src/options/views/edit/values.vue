<template>
  <div class="edit-values flex" ref="$el" :data-editing="current && ''">
    <div class="flex-1 flex flex-col">
      <nav class="mb-1 flex center-items">
        <a @click="onNew" v-if="!readOnly" class="btn-ghost" tabindex="0">
          <Icon name="plus"/>
        </a>
        <template v-if="totalPages > 1">
          <a @click="flipPage(-1)" class="btn-ghost" tabindex="0"
             :class="{ subtle: page === 1 }">⏴</a>
          <input v-model="page" type="number" @wheel="flipPage($event.deltaY > 0 ? 1 : -1)">
          <span v-text="`\xA0/\xA0${totalPages}`"/>
          <a @click="flipPage(1)" class="btn-ghost" tabindex="0"
             :class="{ subtle: page >= totalPages }">⏵</a>
        </template>
        <Dropdown>
          <a class="btn-ghost" tabindex="0">
            <Icon name="info"/>
          </a>
          <template #content>
            <ul>
              <li><kbd>PageUp</kbd>, <kbd>PageDown</kbd></li>
              <li><kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Tab</kbd>, <kbd>Shift-Tab</kbd></li>
              <li><span><kbd>Enter</kbd>: {{i18n('buttonEdit')}},</span></li>
              <li v-if="!readOnly"><span><kbd>Ctrl-Del</kbd>: {{i18n('buttonRemove')}}</span></li>
            </ul>
          </template>
        </Dropdown>
      </nav>
      <div class="edit-values-table main"
         :style="pageKeys.style"
           @keydown.down.exact="onUpDown"
           @keydown.up.exact="onUpDown">
        <a
          ref="$editAll"
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
          <div class="del" @click.stop="onRemove(key)" v-if="!readOnly">
            <icon name="trash"/>
          </div>
        </div>
      </div>
      <div class="edit-values-empty mt-1" v-if="!loading && !keys.length" v-text="i18n('noValues')"/>
      <h3 v-text="i18n('headerRecycleBin')" v-if="trash"/>
      <div class="edit-values-table trash monospace-font"
           @keydown.down.exact="onUpDown"
           @keydown.up.exact="onUpDown"
           :style="trashKeyWidthStyle"
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
    </div>
    <div class="edit-values-panel flex flex-col flex-1 mb-1c" v-if="current">
      <div class="control">
        <h4 v-text="current.isAll ? i18n('labelEditValueAll') : i18n('labelEditValue')"/>
        <div class="flex center-items">
          <a tabindex="0" class="mr-1 flex" @click="editorValueShown = !editorValueShown">
            <Icon name="cog" :class="{ active: editorValueShown }"/>
          </a>
          <button v-for="(text, idx) in [i18n('buttonOK'), i18n('buttonApply')]" :key="text"
                  v-text="text" @click="onSave(idx)"
                  :class="{'has-error': current.error, 'save-beacon': !idx}"
                  :title="current.error"
                  :disabled="current.error || !current.dirty"/>
          <button v-text="i18n('buttonCancel')" @click="onCancel" title="Esc"/>
        </div>
      </div>
      <template v-if="editorValueShown">
        <p class="my-1" v-html="i18n('descEditorOptions')"/>
        <setting-text name="valueEditor" json @dblclick="toggleBoolean" :has-save="false"/>
      </template>
      <label v-show="!current.isAll">
        <span v-text="i18n('valueLabelKey')"/>
        <input type="text" v-model="current.key" :readOnly="!current.isNew || readOnly"
               ref="$key"
               spellcheck="false"
               @keydown="onKeyDownInKeyInput"
               @keydown.esc.exact.stop="onCancel">
      </label>
      <label>
        <span v-text="current.isAll ? i18n('valueLabelValueAll') : i18n('valueLabelValue')"/>
        <vm-code
          :value="current.value"
          :cm-options="cmOptions"
          ref="$value"
          class="h-100 mt-1"
          mode="application/json"
          :readOnly="readOnly"
          @code-dirty="onChange"
          @keydown.tab.shift.exact.capture.stop
          :commands="{ close: onCancel, save: onSave }"
          :active="isActive"
          focusme
        />
      </label>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue';
import { dumpScriptValue, formatByteLength, getBgPage, isEmpty, sendCmdDirectly } from '@/common';
import { handleTabNavigation, keyboardService } from '@/common/keyboard';
import { deepCopy, deepEqual, forEachEntry, mapEntry } from '@/common/object';
import { WATCH_STORAGE } from '@/common/consts';
import hookSetting from '@/common/hook-setting';
import CodeMirror from 'codemirror';
import Dropdown from 'vueleton/lib/dropdown';
import VmCode from '@/common/ui/code';
import Icon from '@/common/ui/icon';
import { getActiveElement, showMessage } from '@/common/ui';
import SettingText from '@/common/ui/setting-text';
import { K_SAVE, kStorageSize, toggleBoolean } from '../../utils';

const props = defineProps({
  /** @type {VMScript} */
  script: Object,
  readOnly: Boolean,
});
const $el = ref();
const $editAll = ref();
const $key = ref();
const $value = ref();
const editorValueShown = ref();
const isActive = ref();
const current = ref();
const loading = ref(true);
const page = ref();
const values = ref();
const trash = ref();
const trashKeyWidthStyle = computed(() => (
  updateKeyWidthStyle(Object.values(trash.value), 'key')
));

const PAGE_SIZE = 25;
const MAX_LENGTH = 1024;
const MAX_JSON_DURATION = 10; // ms
const currentObservables = { error: '', dirty: false };
const cutLength = s => (s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH) : s);
const reparseJson = (str) => {
  try {
    // eslint-disable-next-line no-use-before-define
    return JSON.stringify(JSON.parse(str), null, jsonIndent);
  } catch (e) {
    // This shouldn't happen but the storage may get corrupted or modified directly
    return str;
  }
};
/** Uses a negative tabId which is recognized in bg::values.js */
const fakeSender = () => ({ tab: { id: Math.random() - 2 }, [kFrameId]: 0 });
const conditionNotEdit = { condition: '!edit' };
const onFocus = evt => keyboardService.setContext('edit', 'selectionEnd' in evt.target);

const keys = computed(() => Object.keys(values.value || {}).sort());
const totalPages = computed(() => Math.ceil(keys.value.length / PAGE_SIZE));
const pageKeys = computed(() => {
  const offset = PAGE_SIZE * (page.value - 1);
  const res = keys.value.slice(offset, offset + PAGE_SIZE);
  res.style = updateKeyWidthStyle(res);
  return res;
});

let cm;
let cmOptions;
let jsonIndent = '  ';
let disposeList;
let focusedElement;
let sender;
let storageSentry;

onActivated(() => {
  const root = $el.value;
  const { id } = props.script.props;
  const bg = getBgPage();
  root::addEventListener('focusin', onFocus);
  (current.value ? cm : focusedElement)?.focus();
  sendCmdDirectly('GetValueStore', id, undefined, sender = fakeSender()).then(data => {
    const isFirstTime = !values.value; // DANGER! saving prior to calling setData
    if (setData(data) && isFirstTime && keys.value.length) {
      autofocus(true);
    }
    loading.value = false;
  });
  disposeList = [
    () => root::removeEventListener('focusin', onFocus),
    keyboardService.register('pageup', () => flipPage(-1), conditionNotEdit),
    keyboardService.register('pagedown', () => flipPage(1), conditionNotEdit),
    hookSetting('valueEditor', val => {
      cmOptions = val;
      jsonIndent = ' '.repeat(val?.tabSize || 2);
      if (cm && val) {
        for (const key in val) {
          if (key !== 'mode') cm.setOption(key, val[key]);
        }
      }
    }),
  ];
  storageSentry = chrome.runtime.connect({
    name: WATCH_STORAGE + JSON.stringify({
      cfg: { value: id },
      id: bg?.[WATCH_STORAGE](onStorageChanged),
      tabId: sender.tab.id,
    }),
  });
  if (!bg) storageSentry.onMessage.addListener(onStorageChanged);
  isActive.value = true;
});

onDeactivated(() => {
  isActive.value = false;
  disposeList?.forEach(dispose => dispose());
  storageSentry?.disconnect();
  disposeList = storageSentry = null;
});

watch(current, (val, oldVal) => {
  if (val) {
    focusedElement = getActiveElement();
    nextTick(() => {
      const vmCode = $value.value;
      cm = vmCode.cm;
      if (oldVal) {
        vmCode.updateValue(val.value); // focuses CM, which we may override in isNew below
      }
      if (val.isNew) {
        const el = $key.value;
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
});

watch(page, () => {
  focusedElement = null;
  autofocus();
});

function autofocus(andClick) {
  nextTick(() => {
    $editAll.value[andClick ? 'click' : 'focus']();
  });
}
function flipPage(dir) {
  page.value = Math.max(1, Math.min(totalPages.value, page.value + dir));
}
function getLength(key, raw) {
  // Showing length as key+val not "key" + : + "raw" to avoid confusing users
  const len = key.length + (values.value[key] || raw).length - 1;
  return len < 10_000 ? len : formatByteLength(len);
}
function getValue(key, sliced, raw) {
  let value = values.value[key] || raw;
  const type = value[0];
  value = value.slice(1);
  if (type === 's') value = JSON.stringify(value);
  else if (!sliced) value = reparseJson(value);
  return sliced ? cutLength(value) : value;
}
function getValueAll() {
  return `{\n${jsonIndent}${
    keys.value
    .map(key => `${JSON.stringify(key)}: ${getValue(key)}`)
    .join(',\n')
    .replace(/\n/g, '\n' + jsonIndent) // also handles nested linebreaks inside objects/arrays
  }\n}`;
}
function setData(data, isSave) {
  // Note: default parameter doesn't work when data=null
  data ??= {};
  const oldData = values.value;
  let changed;
  if (isSave) {
    oldData::forEachEntry(([key, val]) => {
      if (val !== data[key]) {
        addToTrash(key);
        changed = true;
      }
    });
    changed ??= true; // empty oldData
  } else {
    changed = !deepEqual(oldData, data);
  }
  if (changed) {
    values.value = data;
    page.value = Math.min(page.value, totalPages.value) || 1;
    calcSize();
    return true;
  }
}
function calcSize() {
  const { script } = props;
  const { $cache = script.$cache = {} } = script;
  const res = keys.value.reduce((sum, key) => sum
    + key.length + 4 + values.value[key].length + 2, 0);
  $cache[kStorageSize] = res ? res + 2 : res; // {}
}

function updateKeyWidthStyle(items, propName) {
  let max = 0;
  for (const item of items) max = Math.max(max, (propName ? item[propName] : item).length);
  return { '--keyW': `${max}ch` };
}
async function updateValue({
  key,
  jsonValue,
  rawValue = dumpScriptValue(jsonValue) || '',
}, isSave) {
  if (isSave && keys.value.includes(key)) {
    addToTrash(key);
  }
  const { id } = props.script.props;
  await sendCmdDirectly('UpdateValue', { [id]: { [key]: rawValue } }, undefined, sender);
  if (rawValue) {
    values.value[key] = rawValue;
  } else {
    delete values.value[key];
  }
  calcSize();
}

function onNew() {
  current.value = {
    isNew: true,
    key: '',
    value: '',
    ...currentObservables,
  };
}
function addToTrash(
  key,
  rawValue = values.value[key],
  cut = getValue(key, true),
  len = getLength(key, rawValue),
) {
  (trash.value || (trash.value = {}))[key + Math.random()] = {
    key,
    rawValue,
    cut,
    len,
  };
}
function onRemove(key) {
  if (props.readOnly) return;
  updateValue({ key });
  addToTrash(key);
  if (current.value?.key === key) {
    current.value = null;
  }
}
function onRestore(trashKey) {
  const obj = trash.value;
  const entry = obj[trashKey];
  delete obj[trashKey];
  if (isEmpty(obj)) trash.value = null;
  updateValue(entry);
}
function onEdit(key) {
  current.value = {
    key,
    value: getValue(key),
    ...currentObservables,
  };
}
function onEditAll() {
  current.value = {
    isAll: true,
    value: getValueAll(),
    ...currentObservables,
  };
}
async function onSave(buttonIndex) {
  const cur = current.value;
  if (cur.jsonPaused) {
    cur.jsonPaused = false;
    onChange();
  }
  if (cur.error) {
    const pos = cur.errorPos;
    cm.setSelection(pos, { line: pos.line, ch: pos.ch + 1 });
    cm.focus();
    showMessage({ text: cur.error });
    return;
  }
  if (buttonIndex === 1) {
    cm.markClean();
    cur.dirty = false;
  } else {
    current.value = null;
  }
  if (cur.isAll) {
    const newValues = cur.jsonValue::mapEntry(val => dumpScriptValue(val) || '');
    await sendCmdDirectly('SetValueStores', {
      [props.script.props.id]: newValues,
    });
    setData(newValues, true);
  } else {
    await updateValue(cur, true);
  }
}
function onCancel() {
  const cur = current.value;
  if (cur.dirty) {
    const str = cm.getValue().trim();
    const {jsonValue = str} = cur;
    addToTrash(cur.key, dumpScriptValue(jsonValue), cutLength(str));
  }
  current.value = null;
}
function onChange(isChanged) {
  const cur = current.value;
  cur.dirty = isChanged;
  cur.error = null;
  const t0 = performance.now();
  const str = cm.getValue().trim();
  try {
    if (cur.isAll && str[0] !== '{') throw 'Expected { at position 0';
    if (cur.jsonPaused) return;
    cur.jsonValue = JSON.parse(str);
  } catch (e) {
    const re = /(position\s+)(\d+)|$/;
    const pos = cm.posFromIndex(+`${e}`.match(re)[2] || 0);
    cur.error = `${e}`.replace(re, `$1${pos.line + 1}:${pos.ch + 1}`);
    cur.errorPos = pos;
    cur.jsonValue = undefined;
  }
  cur.jsonPaused = performance.now() - t0 > MAX_JSON_DURATION;
}
function onKeyDownInKeyInput(evt) {
  if (CodeMirror.keyName(evt) === K_SAVE) {
    onSave();
  }
}
function onStorageChanged(changes) {
  const data = Object.values(changes)[0].newValue;
  if (data) {
    const cur = current.value;
    const currentKey = cur?.key;
    const valueGetter = cur && (cur.isAll ? getValueAll : getValue);
    setData(data instanceof Object ? data : deepCopy(data));
    if (cur) {
      const newText = valueGetter(currentKey);
      const curText = cm.getValue();
      if (curText === newText) {
        cur.isNew = false;
        cur.dirty = false;
      } else if (!cur.dirty) {
        // Updating the current value only if it wasn't yet changed by the user.
        // Keeping the same current.value to avoid triggering `watch` observer
        cur.value = newText;
        onChange();
      }
    }
  } else {
    setData(data);
  }
}
function onUpDown(evt) {
  handleTabNavigation(evt.key === 'ArrowDown' && 1
    || evt.target !== $editAll.value && -1
    || 0); // Prevents Up from escaping the table since we don't listen for Down outside
}
</script>

<style>
$lightBorder: 1px solid var(--fill-2);

.edit-values {
  gap: 1em;
  overflow: hidden;
  @media (max-width: 1200px) {
    &[data-editing] {
      flex-direction: column;
      > :first-child {
        flex: 0 1 min-content;
        overflow-y: auto;
        max-height: 40vh;
        @media (max-height: 600px) {
          display: none;
        }
      }
    }
  }
  nav {
    a.btn-ghost {
      font-size: 1.3rem;
    }
    input {
      padding: 0 1ex;
      max-width: 5ch;
      field-sizing: content;
      -moz-appearance: textfield;
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
      }
    }
    ul {
      width: max-content;
    }
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
        flex: 0 0 var(--keyW);
        box-sizing: content-box;
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
  &-table {
    overflow-y: auto;
    min-height: 2.5em;
  }
  &-panel {
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
  .icon:not(.active) {
    fill: var(--fg);
  }
}
</style>
