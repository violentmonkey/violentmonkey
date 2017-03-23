<template>
  <transition-group tag="div" name="message">
    <div v-for="message in store.messages" class="message"
    :key="message" v-text="message.text"></div>
  </transition>
</template>

<script>
import { store } from '../utils';

export default {
  data() {
    return {
      store,
    };
  },
};
</script>
