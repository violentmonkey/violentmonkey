<template>
  <div class="toggle-button" :class="{active: value}" @click="onToggle">
    <slot></slot>
  </div>
</template>

<script>
export default {
  props: ['value'],
  methods: {
    onToggle() {
      this.$emit('input', !this.value);
    },
  },
};
</script>

<style>
.toggle-button {
  width: 24px;
  height: 24px;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
  color: #333;
  background: #ddd;
  cursor: pointer;
  &.active {
    color: white;
    background: #666;
  }
  &:hover {
    filter: brightness(.8);
  }
}
</style>
