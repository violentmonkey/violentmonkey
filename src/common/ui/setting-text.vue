<template>
  <div class="setting-text">
    <textarea
      ref="$text"
      class="monospace-font"
      :class="{'has-error': error}"
      spellcheck="false"
      v-model="text"
      :disabled="disabled"
      :placeholder="placeholder"
      :rows="rows || calcRows(text)"
      @change="onChange"
      @ctrl-s="onSave"
    />
    <button v-if="hasSave" v-text="saved || i18n('buttonSave')" @click="onSave" :title="ctrlS"
            :disabled="disabled || !canSave"/>
    <button v-if="hasReset" v-text="i18n('buttonReset')" @click="onReset"
            :disabled="disabled || !canReset"/>
    <!-- DANGER! Keep the error tag in one line to keep the space which ensures the first word
         is selected correctly without the preceding button's text on double-click. -->
    <slot/> <span class="error text-red sep" v-text="error" v-if="json"/>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { i18n } from '@/common';
import { getUnloadSentry } from '@/common/router';
import { modifiers } from '@violentmonkey/shortcut';
import { deepEqual, objectGet } from '../object';
import options from '../options';
import defaults from '../options-defaults';
import hookSetting from '../hook-setting';

const props = defineProps({
  name: String,
  json: Boolean,
  disabled: Boolean,
  hasSave: {
    type: Boolean,
    default: true,
  },
  hasReset: Boolean,
  rows: Number,
});
const emit = defineEmits(['bg-error', 'save']);
const ctrlS = modifiers.ctrlcmd === 'm' ? '⌘S' : 'Ctrl-S';
const $text = ref();
const error = ref();
const savedValue = ref();
const saved = ref('');
const text = ref('');
const value = ref();

const handle = props.json
  ? (val => JSON.stringify(val, null, '  '))
  // XXX compatible with old data format
  : (val => (Array.isArray(val) ? val.join('\n') : val || ''));
const defaultValue = objectGet(defaults, props.name);
const placeholder = handle(defaultValue);
const toggleUnloadSentry = getUnloadSentry(() => {
  /* Reset to saved value after confirming loss of data.
     The component won't be destroyed on tab change, so the changes are actually kept.
     Here we reset it to make sure the user loses the changes when leaving the settings tab.
     Otherwise the user may be confused about where the changes are after switching back. */
  text.value = handle(savedValue.value);
});
const revoke = hookSetting(props.name, val => {
  savedValue.value = val;
  text.value = handle(val);
});
const isDirty = computed(() => !deepEqual(value.value, savedValue.value || ''));
const canSave = computed(() => !error.value && isDirty.value);
const canReset = computed(() => !deepEqual(value.value, defaultValue || ''));

defineExpose({
  defaultValue,
  text,
  value,
});
watch(isDirty, toggleUnloadSentry);
watch(text, str => {
  let val;
  let err;
  if (props.json) {
    try {
      val = JSON.parse(str);
    } catch (e) {
      err = e.message;
    }
    error.value = err;
  } else {
    val = str;
  }
  value.value = val;
  saved.value = '';
});
onBeforeUnmount(() => {
  revoke();
  toggleUnloadSentry(false);
});

function onChange() {
  // Auto save if there is no `Save` button
  if (!props.hasSave && canSave.value) onSave();
}
function onSave() {
  options.set(props.name, value.value).catch(bgError);
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
    options.set(props.name, defaultValue).catch(bgError);
  } else {
    // Save button exists = let the user undo the input
    el.select();
    if (!document.execCommand('insertText', false, placeholder.value)) {
      value.value = placeholder.value;
    }
  }
}
function bgError(err) {
  emit('bg-error', err);
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
