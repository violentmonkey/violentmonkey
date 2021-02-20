<template>
  <div class="message modal-content" :class="{ multiline: /\n/.test(message.text) }">
    <div class="mb-1" v-if="message.text" v-text="message.text"></div>
    <form v-if="message.buttons" @submit.prevent>
      <input class="mb-1" type="text" v-if="message.input !== false" v-model="message.input">
      <div class="mr-1c">
        <button
          v-for="(button, index) in message.buttons"
          :key="index"
          :type="button.type || 'button'"
          v-text="button.text"
          @click="onButtonClick(button)"
        />
      </div>
    </form>
  </div>
</template>

<script>
const dismissers = [];

window.addEventListener('keydown', (e) => {
  if (e.keyCode === 27 && dismissers.length) {
    e.stopImmediatePropagation();
    dismissers.pop()();
  }
}, true);

export default {
  props: ['message'],
  created() {
    dismissers.push(this.dismiss);
  },
  mounted() {
    const input = this.$el.querySelector('input');
    if (input) {
      setTimeout(() => {
        input.focus();
      });
    }
  },
  beforeDestroy() {
    const i = dismissers.indexOf(this.dismiss);
    if (i >= 0) dismissers.splice(i, 1);
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
  width: 18rem;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  border-bottom-left-radius: .2rem;
  border-bottom-right-radius: .2rem;
  box-shadow: 0 0 .2rem rgba(0,0,0,.2);
  &.multiline {
    width: auto;
    max-width: 50vw;
    &::first-line {
      font-weight: bold;
      text-decoration: underline;
    }
  }
  input {
    width: 100%;
  }
}
</style>
