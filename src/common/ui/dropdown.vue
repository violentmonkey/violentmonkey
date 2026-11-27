<template>
  <div
    ref="$el"
    class="vl-dropdown"
    :class="`vl-dropdown-${align} vl-dropdown-${direction}`"
    @mouseup="closeAfterClick && close()"
  >
    <div
      class="vl-dropdown-toggle"
      @click="toggle"
      @focus="focusOpen && !open && toggle()"
      @blur="onBlur"
    >
      <slot/>
    </div>
    <div class="vl-dropdown-menu" v-show="open" @mousedown.stop>
      <slot name="content">{{ content }}</slot>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';

defineProps({
  /** Close the menu when it's clicked. */
  closeAfterClick: Boolean,
  /** Open the menu when the toggle is focused. */
  focusOpen: Boolean,
  /** left | right */
  align: {
    type: String,
    default: 'left',
  },
  /** down | up */
  direction: {
    type: String,
    default: 'down',
  },
  /** Content of the menu, can be overridden by `#content` slot. */
  content: String,
});
/** Whether the menu is open, optionally bound via `v-model`. */
const open = defineModel({ type: Boolean, default: false });

const $el = ref();

watch(open, val => {
  if (val) document.addEventListener('mousedown', close, false);
  else document.removeEventListener('mousedown', close, false);
}, { immediate: true });
onBeforeUnmount(() => document.removeEventListener('mousedown', close, false));

function toggle() {
  open.value = !open.value;
}
function close() {
  if (open.value) toggle();
}
function onBlur() {
  const { activeElement } = document;
  if (activeElement !== document.body && !$el.value.contains(activeElement)) {
    close();
  }
}
</script>

<style>
.vl-dropdown {
  position: relative;
  display: inline-block;
  &-toggle {
    cursor: pointer;
  }
  &-menu {
    position: absolute;
    z-index: 10;
  }
  &-right &-menu {
    right: 0;
  }
  &-down &-menu {
    top: 100%;
    margin-top: 5px;
  }
  &-up &-menu {
    bottom: 100%;
    margin-bottom: 5px;
  }
}
</style>
