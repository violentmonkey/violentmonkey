<template>
  <label class="setting-check">
    <input type="checkbox" v-model="value" :disabled>
    <slot>
      <span v-text="label" />
    </slot>
  </label>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import options from '../options';
import hookSetting from '../hook-setting';

const props = defineProps({
  name: String,
  label: String,
  disabled: Boolean,
  sync: {
    type: Boolean,
    default: true,
  },
});
const emit = defineEmits(['change']);
const value = ref();
const revoke = hookSetting(props.name, val => { value.value = val; });

defineExpose({
  value,
});
watch(value, val => {
  // Maxthon is recognized as Chrome in Vue.js.
  // Due to vuejs/vue#4521, model is updated actually on click.
  // Normally `click` event should be fired before `change` event.
  // But Maxthon 4.4 sucks, `change` event is fired first, which breaks everything!
  // And this is fixed in later versions, so we watch the value instead of
  // listening to `change` event to keep the code consistent.
  if (props.sync) options.set(props.name, val);
  emit('change', val);
});
onBeforeUnmount(revoke);
</script>

<style>
.setting-check {
  display: inline-flex;
  flex-wrap: wrap;
  white-space: pre-wrap; /* preserving spaces in html */
  > :nth-child(2) {
    flex: 1 1 min-content; /* wrapping inside the label so it stays in the same row as [x] */
  }
  .vl-dropdown-menu & {
    width: max-content; /* CSS bug(?) workaround for absolutely positioned containers */
  }
}
</style>
