<template>
  <div class="cron-input">
    <input
      v-model="text"
      type="text"
      class="monospace-font"
      :class="{ 'has-error': error }"
      :disabled
      :aria-invalid="!!error"
      spellcheck="false"
      @input="onInput"
      @blur="onBlur"
      @keydown.enter="$event.target.blur()"
    />
    <span v-if="error" class="error text-red" v-text="error" />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { i18n } from '@/common';
import { isValidCron, normalizeCron } from '@/common/cron';

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

watch(() => props.modelValue, value => {
  text.value = value || '';
  error.value = isValidCron(text.value) ? '' : i18n('hintInvalidCron');
}, { immediate: true });

function onInput() {
  error.value = isValidCron(text.value) ? '' : i18n('hintInvalidCron');
}

function onBlur() {
  const value = text.value.trim();
  if (!isValidCron(value)) {
    error.value = i18n('hintInvalidCron');
    return;
  }
  text.value = normalizeCron(value);
  error.value = '';
  if (text.value !== props.modelValue) emit('change', text.value);
}
</script>

<style>
.cron-input {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: .5em;
  input {
    width: 18em;
  }
}
</style>
