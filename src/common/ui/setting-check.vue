<template>
  <input type="checkbox" v-model="value" :disabled="disabled">
</template>

<script>
import options from '../options';
import hookSetting from '../hook-setting';

export default {
  props: {
    name: String,
    disabled: Boolean,
    sync: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      value: null,
    };
  },
  methods: {
    onChange(value) {
      // Maxthon is recognized as Chrome in Vue.js.
      // Due to vuejs/vue#4521, model is updated actually on click.
      // Normally `click` event should be fired before `change` event.
      // But Maxthon 4.4 sucks, `change` event is fired first, which breaks everything!
      // And this is fixed in later versions, so we watch the value instead of
      // listening to `change` event to keep the code consistent.
      if (this.sync) {
        options.set(this.name, value);
      }
      this.$emit('change', value);
    },
  },
  created() {
    options.ready(() => {
      this.value = options.get(this.name);
      this.revoke = hookSetting(this.name, (value) => {
        this.value = value;
      });
      this.$watch('value', this.onChange);
    });
  },
  beforeDestroy() {
    if (this.revoke) this.revoke();
  },
};
</script>
