<template>
  <span class="tooltip" :class="{ disabled }" @mouseenter="onEnter" @mouseleave="onLeave" @click.capture="onClick">
    <slot></slot>
    <div v-if="hovered && title && !disabled" class="tooltip-wrap" :class="`tooltip-${adjustedPlacement} tooltip-align-${align}`">
      <i></i>
      <div><div class="tooltip-text" v-text="title"></div></div>
    </div>
  </span>
</template>

<script>
export default {
  props: {
    title: String,
    placement: {
      type: String,
      default: 'auto-y',
    },
    align: {
      type: String,
      default: 'center', // start | center | end
    },
    disabled: Boolean,
  },
  data() {
    return {
      hovered: false,
      adjustedPlacement: null,
    };
  },
  methods: {
    adjustPlacement() {
      const { placement } = this;
      if (placement === 'auto-y') {
        const rect = this.$el.getBoundingClientRect();
        this.adjustedPlacement = rect.bottom < document.body.clientHeight / 2 ? 'down' : 'up';
      } else {
        this.adjustedPlacement = placement;
      }
    },
    onEnter() {
      this.adjustPlacement();
      this.hovered = true;
    },
    onLeave() {
      this.hovered = false;
    },
    onClick(e) {
      if (this.disabled) e.stopPropagation();
    },
  },
};
</script>

<style>
$bg-color: rgba(0,0,0,.8);
$border-side-width: 4px;
$border-side: $border-side-width solid transparent;
$border-base: 6px solid $bg-color;
$gap: 10px;
$max-width: 250px;

.tooltip {
  display: inline-block;
  position: relative;
  &-wrap {
    position: absolute;
    color: white;
    font-size: 12px;
    line-height: 1.4;
    z-index: 100;
    > * {
      position: absolute;
    }
    > div {
      width: $max-width;
      height: 0;
    }
    &.tooltip-up,
    &.tooltip-down {
      left: 50%;
      > i {
        margin-left: -$border-side-width;
      }
      &.tooltip-align-center {
        > div {
          left: 50%;
          // calc will be reduced by cssnano
          margin-left: calc(-$max-width / 2);
          text-align: center;
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
          text-align: right;
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
      .tooltip-text {
        transform: translateY(-100%);
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
    }
    &.tooltip-left,
    &.tooltip-right {
      top: 50%;
      > i,
      .tooltip-text {
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
        text-align: right;
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
  &-text {
    display: inline-block;
    padding: 8px;
    background: $bg-color;
    border-radius: 6px;
    text-align: left;
  }
}
</style>
