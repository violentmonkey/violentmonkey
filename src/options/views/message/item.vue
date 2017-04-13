<template>
  <div class="message-wrap">
    <div class="message-backdrop fixed-full"
    v-if="message.backdrop || message.onBackdropClick"
    @click="onBackdropClick"></div>
    <div class="message">
      <div class="mb-1" v-if="message.text" v-text="message.text"></div>
      <form v-if="message.buttons" @submit.prevent>
        <input class="mb-1" type="text" v-if="message.input !== false" v-model="message.input">
        <div>
          <button v-for="button in message.buttons" class="mr-1"
          :type="button.type || 'button'" v-text="button.text"
          @click="onButtonClick(button)"></button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
export default {
  props: ['message'],
  mounted() {
    const input = this.$el.querySelector('input');
    if (input) input.focus();
    const { onInit } = this.message;
    if (onInit) onInit(this);
  },
  methods: {
    onButtonClick(button) {
      const { onClick } = button;
      if (onClick) {
        if (onClick(this.message.input) !== false) this.dismiss();
      }
    },
    onBackdropClick() {
      const { onBackdropClick } = this.message;
      if (onBackdropClick) {
        if (onBackdropClick() !== false) this.dismiss();
      }
    },
    dismiss() {
      this.$emit('dismiss');
    },
  },
};
</script>

<style>
.message {
  position: absolute;
  width: 14rem;
  top: 0;
  left: 50%;
  margin-left: -7rem;
  padding: 1rem;
  background: white;
  border-bottom-left-radius: .2rem;
  border-bottom-right-radius: .2rem;
  box-shadow: 0 0 .2rem rgba(0,0,0,.2);
  transition: transform .5s;
  &-wrap {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    /* For Vue.js to know the transition duration */
    transition: transform .5s;
  }
  &-backdrop {
    background: black;
    opacity: .4;
    transition: opacity .5s;
    .message-enter &,
    .message-leave-active & {
      opacity: 0;
    }
  }
  .message-enter &,
  .message-leave-active & {
    transform: translateY(-120%);
  }
}
</style>
