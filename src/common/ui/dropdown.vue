<template>
  <div class="dropdown" :class="`dropdown-${align}`" @mouseup="onMouseUp">
    <div class="dropdown-toggle" @click="onToggle" @focus="onFocus" @blur="onBlur">
      <slot name="toggle"></slot>
    </div>
    <div class="dropdown-menu" v-show="active" @mousedown.stop>
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    // If true, the dropdown menu will close on menu clicked.
    closeAfterClick: {
      type: Boolean,
      default: false,
    },
    // If true, the dropdown menu will always open on toggle clicked.
    toggleOnOnly: {
      type: Boolean,
      default: false,
    },
    // If true, the dropdown menu will open on toggle focused.
    focusOpen: {
      type: Boolean,
      default: false,
    },
    // Set alignment of the dropdown menu, can be either 'left' or 'right'.
    align: {
      type: String,
      default: 'left',
    },
  },
  data() {
    return {
      active: false,
    };
  },
  watch: {
    active(active, formerActive) {
      if (active === formerActive) return;
      if (active) {
        document.addEventListener('mousedown', this.onClose, false);
      } else {
        document.removeEventListener('mousedown', this.onClose, false);
      }
    },
  },
  methods: {
    onToggle() {
      this.active = !this.active;
    },
    onOpen() {
      this.active = true;
    },
    onClose() {
      this.active = false;
    },
    onFocus() {
      if (this.focusOpen) this.onOpen();
    },
    onBlur() {
      const { activeElement } = document;
      if (activeElement !== document.body && !this.$el.contains(activeElement)) this.onClose();
    },
    onMouseUp() {
      if (this.closeAfterClick) this.onClose();
    },
  },
};
</script>

<style>
.dropdown {
  position: relative;
  display: inline-block;
  &-toggle {
    cursor: pointer;
  }
  &-menu {
    position: absolute;
    top: 100%;
    margin-top: .4rem;
    padding: .5rem;
    border: 1px solid #bbb;
    background: white;
    z-index: 10;
    .dropdown-right & {
      right: 0;
    }
  }
}
</style>
