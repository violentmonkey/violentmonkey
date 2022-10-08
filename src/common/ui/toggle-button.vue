<template>
  <div class="toggle-button" :class="{active: modelValue}"
       tabindex="0"
       @keypress.enter.exact="onToggle"
       @keypress.space.exact="onToggle"
       @click="onToggle">
    <slot></slot>
  </div>
</template>

<script setup>
const props = defineProps(['modelValue']);
const emits = defineEmits(['update:modelValue']);

function onToggle() {
  emits('update:modelValue', !props.modelValue);
}
</script>

<style>
.toggle-button {
  width: 24px;
  height: 24px;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
  color: var(--fill-12);
  background: var(--fill-2);
  cursor: pointer;
  &.active {
    color: var(--bg);
    background: var(--fill-9);
  }
  &:focus, &:hover {
    filter: brightness(.8);
  }
}
</style>
