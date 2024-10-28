<template>
  <div class="setting-text">
    <textarea
      ref="$text"
      class="monospace-font"
      :class="{'has-error': error}"
      spellcheck="false"
      v-model="text"
      :disabled
      :placeholder
      :rows="rows || calcRows(text)"
      @ctrl-s="onSave"
    />
    <button v-if="hasSave" v-text="saved || i18n('buttonSave')" @click="onSave" :title="ctrlS"
            :disabled="disabled || !canSave"/>
    <button v-if="hasReset" v-text="i18n('buttonReset')" @click="onReset"
            :disabled="disabled || !canReset"/>
    <!-- DANGER! Keep the error tag in one line to keep the space which ensures the first word
         is selected correctly without the preceding button's text on double-click. -->
    <slot/> <template v-if="error">
      <span v-if="typeof error === 'string'" class="error text-red sep" v-text="error"/>
      <ol v-else class="text-red"><li v-for="e in error" :key="e" v-text="e"/></ol>
    </template>
  </div>
</template>

<script>
import { modifiers } from '@violentmonkey/shortcut';

const ctrlS = modifiers.ctrlcmd === 'm' ? '⌘S' : 'Ctrl-S';
/** XXX compatible with old data format */
const handleArray = val => (Array.isArray(val) ? val.join('\n') : val || '');
const handleJSON = val => JSON.stringify(val, null, '  ');
</script>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { i18n } from '@/common';
import { getUnloadSentry } from '@/common/router';
import { deepEqual, objectGet } from '../object';
import options from '../options';
import defaults from '../options-defaults';
import hookSetting from '../hook-setting';

let savedValue;
let savedValueText;

const props = defineProps({
  name: String,
  json: Boolean,
  disabled: Boolean,
  getErrors: Function,
  hasSave: {
    type: Boolean,
    default: true,
  },
  hasReset: Boolean,
  rows: Number,
});
const emit = defineEmits(['save']);
const $text = ref();
const canSave = ref();
const canReset = ref();
const error = ref();
const isDirty = ref();
const saved = ref('');
const text = ref('');
const value = ref();

const handle = props.json ? handleJSON : handleArray;
const defaultValue = objectGet(defaults, props.name);
const placeholder = handle(defaultValue);
const toggleUnloadSentry = getUnloadSentry(() => {
  /* Reset to saved value after confirming loss of data.
     The component won't be destroyed on tab change, so the changes are actually kept.
     Here we reset it to make sure the user loses the changes when leaving the settings tab.
     Otherwise the user may be confused about where the changes are after switching back. */
  text.value = handle(savedValue);
});
const revoke = hookSetting(props.name, val => {
  savedValue = val;
  text.value = savedValueText = handle(val);
});

defineExpose({
  defaultValue,
  text,
  value,
});
watch(isDirty, toggleUnloadSentry);
watch(text, str => {
  let _isDirty, _canSave, isSavedValueText;
  let val;
  let err;
  if (props.json) {
    try {
      isSavedValueText = str === savedValueText;
      val = isSavedValueText ? savedValue : JSON.parse(str);
    } catch (e) {
      err = e.message;
    }
    error.value = err;
  } else {
    val = str;
  }
  value.value = val;
  saved.value = '';
  canReset.value = !deepEqual(val, defaultValue || '');
  isDirty.value = _isDirty = !isSavedValueText && !deepEqual(val, savedValue || '');
  canSave.value = _canSave = _isDirty && !err;
  if (_canSave && !props.hasSave) onSave(); // Auto save if there is no `Save` button
});
onMounted(async () => {
  error.value = await props.getErrors?.();
});
onBeforeUnmount(() => {
  revoke();
  toggleUnloadSentry(false);
});

function onSave() {
  options.set(props.name, savedValue = value.value).then(bgError, bgError);
  savedValueText = text.value;
  isDirty.value = canSave.value = false;
  saved.value = i18n('buttonSaved');
  emit('save');
}
function onReset() {
  const el = $text.value;
  /* Focusing to allow quick Ctrl-Z to undo.
   * Focusing also prevents layout shift when `reset` button auto-hides. */
  el.focus();
  if (!props.hasSave) {
    // No save button = something rather trivial e.g. the export file name
    options.set(props.name, defaultValue).then(bgError, bgError);
  } else {
    // Save button exists = let the user undo the input
    el.select();
    if (!document.execCommand('insertText', false, placeholder)) {
      value.value = placeholder;
    }
  }
}
function bgError({ message: m } = {}) {
  if (m) try { m = JSON.parse(m); } catch {/**/}
  error.value = m && (
    m.length <= 1 && Array.isArray(m)
      ? m[0]
      : m
  );
}
</script>

<style>
.setting-text {
  > .error {
    /* We've used .sep so our error text aligns with the buttons, now we need to undo some parts */
    display: inline;
    &::after {
      content: none;
    }
  }
}
</style>
