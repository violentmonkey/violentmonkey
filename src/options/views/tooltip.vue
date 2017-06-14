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
$border-base: 8px solid $bg-color;

.tooltip {
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
    &.tooltip-up {
      left: 50%;
      bottom: 100%;
      transform: translate(-50%,-10px);
      &::before {
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-top: $border-base;
        border-left: $border-side;
        border-right: $border-side;
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
