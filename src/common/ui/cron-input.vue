<template>
  <form class="cron-input" :class="{ disabled }" @submit.prevent="onApply">
    <div class="cron-input-row">
      <input
        v-model="text"
        type="text"
        class="monospace-font"
        :class="{ 'has-error': error }"
        :disabled
        :aria-invalid="!!error"
        spellcheck="false"
        @input="onInput"
        @focus="onFocus"
        @click="onCaretMove"
        @select="onCaretMove"
        @keyup="onCaretMove"
      />
      <div v-if="showHelp" class="cron-input-actions">
        <button type="submit" :disabled="disabled || !!error" v-text="i18n('buttonOK')"/>
        <button type="button" :disabled="disabled" @click="onCancel" v-text="i18n('buttonCancel')"/>
      </div>
      <span v-if="error" class="error text-red" v-text="error" />
    </div>
    <div v-if="showHelp" class="cron-help">
      <div class="cron-help-head">
        <div class="cron-help-stars monospace-font" aria-hidden="true">
          <span
            v-for="field in CRON_FIELDS"
            :key="field.index"
            :class="activeField === field.index ? 'cron-active' : 'cron-muted'"
            v-text="field.star"
          ></span>
        </div>
        <div class="cron-help-shortcuts">
          <button
            v-for="preset in CRON_PRESETS"
            :key="preset.label"
            type="button"
            :disabled="disabled"
            :title="preset.value"
            @click="onPreset(preset)"
            v-text="preset.label"
          ></button>
        </div>
      </div>
      <div class="cron-help-body">
        <svg
          class="cron-help-lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            v-for="field in CRON_FIELDS"
            :key="field.index"
            :d="field.path"
            :class="activeField === field.index ? 'cron-active' : 'cron-muted'"
          ></path>
        </svg>
        <div class="cron-help-labels">
          <span
            v-for="field in CRON_LABELS"
            :key="field.index"
            :class="activeField === field.index ? 'cron-active' : 'cron-muted'"
            v-text="`${field.label} (${field.range})`"
          ></span>
        </div>
      </div>
    </div>
  </form>
</template>

<script setup>
import { ref, watch } from 'vue';
import { i18n } from '@/common';
import { isValidCron, normalizeCron } from '@/common/cron';

const ERROR_TEXT = i18n('hintInvalidCron');
const CRON_FIELDS = [
  {
    index: 0,
    star: '*',
    label: i18n('labelCronMinute'),
    range: '0-59',
    path: 'M10 0 V90 H100',
  },
  {
    index: 1,
    star: '*',
    label: i18n('labelCronHour'),
    range: '0-23',
    path: 'M30 0 V70 H100',
  },
  {
    index: 2,
    star: '*',
    label: i18n('labelCronDayOfMonth'),
    range: '1-31',
    path: 'M50 0 V50 H100',
  },
  {
    index: 3,
    star: '*',
    label: i18n('labelCronMonth'),
    range: '1-12',
    path: 'M70 0 V30 H100',
  },
  {
    index: 4,
    star: '*',
    label: i18n('labelCronDayOfWeek'),
    range: '0-6',
    path: 'M90 0 V10 H100',
  },
];
const CRON_LABELS = CRON_FIELDS.slice().reverse();
const CRON_PRESETS = [
  { label: i18n('labelCronDaily'), value: '0 12 * * *' },
  { label: i18n('labelCronTwiceADay'), value: '0 */2 * * *' },
  { label: i18n('labelCronHourly'), value: '0 * * * *' },
];

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  disabled: Boolean,
});
const emit = defineEmits(['change']);
const text = ref(props.modelValue);
const error = ref();
const activeField = ref(-1);
const showHelp = ref(false);

watch(() => props.modelValue, value => {
  text.value = value || '';
  error.value = isValidCron(text.value) ? '' : ERROR_TEXT;
}, { immediate: true });

function onFocus(event) {
  showHelp.value = true;
  onCaretMove(event);
}

function onInput(event) {
  error.value = isValidCron(event.currentTarget.value) ? '' : ERROR_TEXT;
  onCaretMove(event);
}

function onCaretMove(event) {
  const { currentTarget } = event;
  if (currentTarget.selectionStart == null) return;
  activeField.value = getActiveField(currentTarget.value, currentTarget.selectionStart);
}

function getActiveField(value, position) {
  let field = 0;
  for (const match of value.matchAll(/\S+/g)) {
    if (position <= match.index) break;
    if (position <= match.index + match[0].length) return field;
    field += 1;
  }
  return Math.min(field, CRON_FIELDS.length - 1);
}

function onPreset({ value }) {
  text.value = normalizeCron(value);
  error.value = '';
}

function onApply() {
  const value = text.value.trim();
  if (!isValidCron(value)) {
    error.value = ERROR_TEXT;
    return;
  }
  text.value = normalizeCron(value);
  error.value = '';
  showHelp.value = false;
  if (text.value !== props.modelValue) emit('change', text.value);
}

function onCancel() {
  text.value = props.modelValue || '';
  error.value = isValidCron(text.value) ? '' : ERROR_TEXT;
  showHelp.value = false;
}
</script>

<style>
.cron-input {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  gap: 8px;
  padding-block: 4px;

  input {
    width: 18em;
    font-size: 14px;
    line-height: 20px;
  }

  .error {
    font-size: 12px;
    line-height: 16px;
  }

  &.disabled .cron-help {
    opacity: .5;
  }
}

.cron-input-row,
.cron-input-actions,
.cron-help-head,
.cron-help-shortcuts {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cron-input-row {
  width: 100%;
}

.cron-input-actions button,
.cron-help-shortcuts button {
  height: 20px;
  padding: 0 6px;
  border-radius: 2px;
  font-size: 12px;
  line-height: 18px;
}

.cron-muted,
.cron-active {
  font-size: 12px;
  line-height: 16px;
  transition: color .1s;
}

.cron-muted {
  color: var(--fill-7);
}

.cron-active {
  color: var(--focus-border-color);
}

.cron-help {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  overflow-x: auto;
  color: var(--fg);
  font-size: 12px;
  line-height: 16px;
}

.cron-help-head {
  min-width: max-content;
}

.cron-help-stars {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  width: 80px;
  height: 16px;
  text-align: center;
}

.cron-help-shortcuts {
  white-space: nowrap;
}

.cron-help-body {
  display: grid;
  grid-template-columns: 80px max-content;
  align-items: start;
  gap: 8px;
  min-width: max-content;
}

.cron-help-lines {
  width: 80px;
  height: 80px;
  overflow: visible;
  pointer-events: none;

  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    transition: color .1s, stroke-width .1s;

    &.cron-active {
      stroke-width: 2;
    }
  }
}

.cron-help-labels {
  display: grid;
  grid-template-rows: repeat(5, 16px);
  min-width: max-content;
  white-space: nowrap;
}
</style>
