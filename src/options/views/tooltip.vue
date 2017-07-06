<template>
  <span class="tooltip">
    <slot></slot>
    <div class="tooltip-title" :class="`tooltip-${placement}`" v-text="title"></div>
  </span>
</template>

<script>
export default {
  props: {
    title: String,
    placement: {
      type: String,
      default: 'up',
    },
  },
};
</script>

<style>
$bg-color: rgba(0,0,0,.8);
$border-side: 4px solid transparent;
$border-base: 6px solid $bg-color;
$gap: 10px;

.tooltip {
  display: inline-block;
  position: relative;
  &-title {
    display: none;
    position: absolute;
    padding: 8px;
    white-space: nowrap;
    border-radius: 6px;
    background: $bg-color;
    color: white;
    font-size: 12px;
    z-index: 100;
    .tooltip:hover & {
      display: block;
    }
    &::before {
      content: '';
      position: absolute;
    }
    &.tooltip-up,
    &.tooltip-down {
      &,
      &::before {
        left: 50%;
        transform: translateX(-50%);
      }
    }
    &.tooltip-up {
      bottom: 100%;
      margin-bottom: $gap;
      &::before {
        top: 100%;
        border-top: $border-base;
        border-left: $border-side;
        border-right: $border-side;
      }
    }
    &.tooltip-down {
      top: 100%;
      margin-top: $gap;
      &::before {
        bottom: 100%;
        border-left: $border-side;
        border-right: $border-side;
        border-bottom: $border-base;
      }
    }
    &.tooltip-right {
      top: 50%;
      left: 100%;
      transform: translate(10px,-50%);
      &::before {
        top: 50%;
        right: 100%;
        transform: translateY(-50%);
        border-top: $border-side;
        border-right: $border-base;
        border-bottom: $border-side;
      }
    }
  }
}
</style>
