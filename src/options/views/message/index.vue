<template>
  <transition-group tag="div" name="message">
    <item v-for="message in store.messages" :key="message"
    :message="message" @dismiss="onDismiss(message)" />
  </transition-group>
</template>

<script>
import { store } from 'src/options/utils';
import Item from './item';

export default {
  components: {
    Item,
  },
  data() {
    return {
      store,
    };
  },
  methods: {
    onDismiss(message) {
      const i = store.messages.indexOf(message);
      if (i >= 0) store.messages.splice(i, 1);
    },
  },
};
</script>
