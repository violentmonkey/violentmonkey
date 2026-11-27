<template>
  <teleport to="body">
    <transition :name="transition" @after-leave="emit('afterLeave')" appear>
      <div :class="`vl-modal ${modalClass}`" v-if="show">
        <div
          :class="`vl-modal-backdrop ${backdropClass}`"
          v-if="backdrop"
          @click="onBackdropClick"
        />
        <slot/>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
const props = defineProps({
  modalClass: {
    type: String,
    default: '',
  },
  backdropClass: {
    type: String,
    default: '',
  },
  transition: {
    type: String,
    default: '',
  },
  show: Boolean,
  backdrop: {
    type: [Object, Boolean],
    default: () => ({ close: true }),
  },
});
const emit = defineEmits(['close', 'afterLeave']);

function onBackdropClick() {
  if (props.backdrop === true || props.backdrop.close) {
    emit('close', { source: 'backdrop' });
  }
}
</script>

<style>
.vl-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  text-align: center;
  &-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,.4);
    z-index: -1;
  }
}
</style>
