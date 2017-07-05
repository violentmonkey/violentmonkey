<template>
  <input type="checkbox" v-model="value" @change="onChange" :disabled="disabled">
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
  created() {
    this.value = options.get(this.name);
    this.revoke = hookSetting(this.name, value => {
      this.value = value;
    });
  },
  beforeDestroy() {
    this.revoke();
  },
  methods: {
    onChange() {
      if (this.sync) {
        options.set(this.name, this.value);
      }
      this.$emit('change', this.value);
    },
  },
};
</script>
