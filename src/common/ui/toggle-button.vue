<template>
  <!-- Using an unstyled button for proper native accessibility and Space/Enter keys -->
  <button class="toggle-button" :class="{active: model}" @click="model = !model">
    <slot/>
  </button>
</template>

<script setup>
const model = defineModel({ type: Boolean });
</script>

<style>
.toggle-button {
  color: var(--fill-12);
  background: var(--fill-2);
  border-color: var(--fill-3);
  &.active {
    color: var(--bg);
    background: var(--fill-9);
  }
}
</style>
