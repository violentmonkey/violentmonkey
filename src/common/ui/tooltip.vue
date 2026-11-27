<template>
  <span
    ref="$el"
    :class="{ disabled }"
    @mouseenter="onEnter"
    @mouseleave="hovered = false"
    @tipshow.stop="hovered = true"
    @tiphide.stop="hovered = false"
    @tiptoggle.stop="hovered = !hovered"
  >
    <slot/>
    <teleport to="body" v-if="tooltip">
      <div
        class="vl-tooltip"
        :class="`vl-tooltip-${tooltip.placement} vl-tooltip-align-${tooltip.align}`"
        :style="tooltip.style"
      >
        <i/>
        <div class="vl-tooltip-wrap">
          <div class="vl-tooltip-content">
            <slot name="content">{{ content }}</slot>
          </div>
        </div>
      </div>
    </teleport>
  </span>
</template>

<script>
const PLACEMENT_TOP = 'top';
const PLACEMENT_BOTTOM = 'bottom';
const PLACEMENT_LEFT = 'left';
const PLACEMENT_RIGHT = 'right';
const PLACEMENT_AUTO_Y = 'auto-y';
/** @type {Set<() => void>} */
const renderers = new Set();
let rafPending;

function onViewportChange() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderers.forEach(fn => fn());
  });
}

document.addEventListener('scroll', onViewportChange, true);
addEventListener('resize', onViewportChange, false);
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  active: Boolean,
  noMouse: Boolean,
  placement: {
    type: String,
    default: PLACEMENT_AUTO_Y,
  },
  /** start | center | end */
  align: {
    type: String,
    default: 'center',
  },
  content: String,
  gap: {
    type: Number,
    default: 10,
  },
  disabled: Boolean,
});

const $el = ref();
const hovered = ref(false);
const tooltip = ref(null);
const shouldShow = computed(() => !props.disabled && (props.active || hovered.value));

function onEnter() {
  if (!props.disabled && !props.noMouse) hovered.value = true;
}

function render() {
  if (!shouldShow.value) {
    tooltip.value = null;
    return;
  }
  const rect = $el.value.getBoundingClientRect();
  const { gap } = props;
  let left = scrollX;
  let top = scrollY;
  let { placement } = props;
  if (placement === PLACEMENT_AUTO_Y) {
    placement = rect.bottom < document.body.clientHeight / 2 ? PLACEMENT_BOTTOM : PLACEMENT_TOP;
  }
  if (placement === PLACEMENT_TOP || placement === PLACEMENT_BOTTOM) {
    left += rect.left + rect.width / 2;
    top += placement === PLACEMENT_TOP ? rect.top - gap : rect.bottom + gap;
  } else if (placement === PLACEMENT_LEFT || placement === PLACEMENT_RIGHT) {
    top += rect.top + rect.height / 2;
    left += placement === PLACEMENT_LEFT ? rect.left - gap : rect.right + gap;
  } else if (__.DEV) {
    console.warn(`Unknown placement: ${placement}`);
  }
  tooltip.value = {
    placement,
    align: props.align,
    style: {
      top: `${top}px`,
      left: `${left}px`,
    },
  };
}

watch(() => [shouldShow.value, props.placement, props.align, props.content, props.gap], render);
onMounted(() => {
  renderers.add(render);
  render();
});
onBeforeUnmount(() => {
  renderers.delete(render);
  tooltip.value = null;
});
</script>

<style>
:root {
  --vl-tooltip-bg: rgba(0,0,0,.8);
  --vl-tooltip-max-width: 250px;
  --vl-tooltip-arrow-width: 4px;
  --vl-tooltip-arrow-height: 6px;
}
.vl-tooltip {
  position: absolute;
  color: white;
  font-size: 12px;
  line-height: 1.4;
  z-index: 100;
  > i {
    position: absolute;
    color: var(--vl-tooltip-bg);
  }
  > .vl-tooltip-wrap {
    position: absolute;
  }
  &-wrap {
    width: var(--vl-tooltip-max-width);
  }
  &-content {
    display: inline-block;
    padding: 8px;
    background: var(--vl-tooltip-bg);
    border-radius: 6px;
    text-align: left;
  }
  &-top,
  &-bottom {
    > i {
      border-left: var(--vl-tooltip-arrow-width) solid transparent;
      border-right: var(--vl-tooltip-arrow-width) solid transparent;
      margin-left: calc(var(--vl-tooltip-arrow-width) * -1);
    }
    &.vl-tooltip-align-center > .vl-tooltip-wrap {
      margin-left: calc(var(--vl-tooltip-max-width) / -2);
      text-align: center;
    }
    &.vl-tooltip-align-start > .vl-tooltip-wrap {
      margin-left: -10px;
      text-align: left;
    }
    &.vl-tooltip-align-end > .vl-tooltip-wrap {
      right: 0;
      margin-right: -10px;
      text-align: right;
    }
  }
  &-left,
  &-right {
    > i {
      border-top: var(--vl-tooltip-arrow-width) solid transparent;
      border-bottom: var(--vl-tooltip-arrow-width) solid transparent;
      margin-top: calc(var(--vl-tooltip-arrow-width) * -1);
    }
  }
  &-top {
    > i {
      top: 0;
      border-top: var(--vl-tooltip-arrow-height) solid currentColor;
    }
    > .vl-tooltip-wrap {
      bottom: 0;
    }
  }
  &-bottom {
    > i {
      bottom: 0;
      border-bottom: var(--vl-tooltip-arrow-height) solid currentColor;
    }
    > .vl-tooltip-wrap {
      top: 0;
    }
  }
  &-left {
    > i {
      left: 0;
      border-left: var(--vl-tooltip-arrow-height) solid currentColor;
    }
    > .vl-tooltip-wrap {
      right: 0;
      text-align: right;
      transform: translateY(-50%);
    }
  }
  &-right {
    > i {
      right: 0;
      border-right: var(--vl-tooltip-arrow-height) solid currentColor;
    }
    > .vl-tooltip-wrap {
      left: 0;
      transform: translateY(-50%);
    }
  }
}
</style>
