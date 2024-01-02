<template>
  <div class="message modal-content">
    <div class="message-body">
      <p v-text="content.title"></p>
      <p v-text="content.desc" v-if="content.desc"></p>
    </div>
    <form v-if="message.buttons" @submit.prevent ref="refForm">
      <!-- eslint-disable vue/no-mutating-props -->
      <input
        class="mb-1"
        type="text"
        v-if="message.input !== false"
        v-model="message.input"
      />
      <!-- eslint-enable vue/no-mutating-props -->
      <div class="mr-1c">
        <button
          v-for="({text, type, onClick, ...extras}, index) in message.buttons"
          :key="index"
          :type="type || 'button'"
          v-text="text"
          v-bind="extras"
          @click="onButtonClick(onClick)"
        />
      </div>
    </form>
  </div>
</template>

<script>
import { computed, nextTick, onMounted, ref } from 'vue';
import { hasKeyModifiers } from '@/common/ui/index';

const dismissers = [];

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dismissers.length && !hasKeyModifiers(e)) {
    e.stopImmediatePropagation();
    dismissers.pop()();
  }
}, true);

export default {
  props: ['message'],
  setup(props, context) {
    const refForm = ref();
    const dismiss = () => {
      dismissers.length = 0;
      context.emit('dismiss');
    };
    const onButtonClick = onClick => {
      if (onClick) {
        if (onClick(props.message.input) !== false) dismiss();
      }
    };
    const onBackdropClick = () => {
      const cb = props.message.onBackdropClick;
      if (cb && cb() !== false) dismiss();
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
      const el = refForm.value?.querySelector('input, button');
      if (el) nextTick(() => el.focus());
      dismissers.push(dismiss);
      return () => {
        const i = dismissers.indexOf(dismiss);
        if (i >= 0) dismissers.splice(i, 1);
      };
    });

    return {
      refForm,
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
      &:nth-last-child(2) { /* matches the first <p> when there are two <p> in multiline mode */
        font-weight: bold;
      }
      &:not(:first-child) {
        text-align: left;
      }
    }
  }
}
</style>
