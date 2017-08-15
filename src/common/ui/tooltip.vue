<template>
  <span class="tooltip">
    <slot></slot>
    <div class="tooltip-title" :class="`tooltip-${placement} tooltip-align-${align}`">
      <i></i>
      <div v-text="title"></div>
    </div>
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
    align: {
      type: String,
      default: 'center', // start | center | end
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
    color: white;
    font-size: 12px;
    z-index: 100;
    .tooltip:hover & {
      display: block;
    }
    > * {
      position: absolute;
      white-space: nowrap;
    }
    > div {
      padding: 8px;
      background: $bg-color;
      border-radius: 6px;
    }
    &.tooltip-up,
    &.tooltip-down {
      left: 50%;
      > i {
        transform: translateX(-50%);
      }
      &.tooltip-align-center {
        > div {
          left: 50%;
          transform: translateX(-50%);
        }
      }
      &.tooltip-align-start {
        > div {
          left: -10px;
        }
      }
      &.tooltip-align-end {
        > div {
          right: -10px;
        }
      }
    }
    &.tooltip-up {
      bottom: 100%;
      margin-bottom: $gap;
      > i {
        top: 100%;
        border-top: $border-base;
        border-left: $border-side;
        border-right: $border-side;
      }
      > div {
        bottom: 0;
      }
    }
    &.tooltip-down {
      top: 100%;
      margin-top: $gap;
      > i {
        bottom: 100%;
        border-left: $border-side;
        border-right: $border-side;
        border-bottom: $border-base;
      }
      > div {
        top: 0;
      }
    }
    &.tooltip-left,
    &.tooltip-right {
      top: 50%;
      > * {
        transform: translateY(-50%);
      }
      > i {
        border-top: $border-side;
        border-bottom: $border-side;
      }
    }
    &.tooltip-left {
      margin-right: 10px;
      right: 100%;
      > div {
        right: 100%;
      }
      > i {
        left: 100%;
        border-left: $border-base;
      }
    }
    &.tooltip-right {
      margin-left: 10px;
      left: 100%;
      > div {
        left: 100%;
      }
      > i {
        right: 100%;
        border-right: $border-base;
      }
    }
  }
}
</style>
