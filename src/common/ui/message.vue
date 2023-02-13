<template>
  <div class="message modal-content">
    <div class="message-body">
      <p v-text="content.title"></p>
      <p v-text="content.desc" v-if="content.desc"></p>
    </div>
    <form v-if="message.buttons" @submit.prevent>
      <!-- eslint-disable vue/no-mutating-props -->
      <input
        ref="refInput"
        class="mb-1"
        type="text"
        v-if="message.input !== false"
        v-model="message.input"
      />
      <!-- eslint-enable vue/no-mutating-props -->
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
import { computed, nextTick, onMounted, ref } from 'vue';

const dismissers = [];

window.addEventListener('keydown', (e) => {
  if (e.keyCode === 27 && dismissers.length) {
    e.stopImmediatePropagation();
    dismissers.pop()();
  }
}, true);

export default {
  props: ['message'],
  setup(props, context) {
    const refInput = ref();
    const dismiss = () => {
      context.emit('dismiss');
    };
    const onButtonClick = button => {
      const { onClick } = button;
      if (onClick) {
        if (onClick(props.message.input) !== false) dismiss();
      }
    };
    const onBackdropClick = () => {
      const { onBackdropClick } = props.message;
      if (onBackdropClick) {
        if (onBackdropClick() !== false) dismiss();
      }
    };
    const content = computed(() => {
      const { text } = props.message;
      const sep = text.indexOf('\n\n');
      if (sep > 0) {
        return { title: text.slice(0, sep), desc: text.slice(sep + 2) };
      }
      return { title: text };
    });

    onMounted(() => {
      if (refInput.value) {
        nextTick(() => {
          refInput.value.focus();
        });
      }
      dismissers.push(dismiss);
      return () => {
        const i = dismissers.indexOf(dismiss);
        if (i >= 0) dismissers.splice(i, 1);
      };
    });

    return {
      refInput,
      content,
      onButtonClick,
      onBackdropClick,
    };
  },
};
</script>

<style>
.message {
  max-width: 50vw;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  border-bottom-left-radius: .2rem;
  border-bottom-right-radius: .2rem;
  box-shadow: 0 0 .2rem rgba(0,0,0,.2);
  input {
    width: 100%;
  }
  &-body {
    > p {
      margin-bottom: 1em;
      &:first-child {
        font-weight: bold;
        text-decoration: underline;
      }
      &:not(:first-child) {
        text-align: left;
      }
    }
  }
}
</style>
