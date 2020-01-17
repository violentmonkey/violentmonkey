<template>
  <textarea
    class="monospace-font"
    :class="{'has-error': error}"
    spellcheck="false"
    v-model="value"
    :disabled="disabled"
    :title="error"
    @change="onChange"
  />
</template>

<script>
import options from '../options';
import hookSetting from '../hook-setting';

export default {
  props: {
    name: String,
    json: Boolean,
    disabled: Boolean,
    sync: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      value: null,
      jsonValue: null,
      error: null,
    };
  },
  created() {
    const transform = this.json
      ? (value => JSON.stringify(value, null, '  '))
      // XXX compatible with old data format
      : (value => (Array.isArray(value) ? value.join('\n') : value || ''));
    this.revoke = hookSetting(this.name, { target: this, prop: 'value', transform });
    if (this.json) this.$watch('value', this.parseJson);
  },
  beforeDestroy() {
    this.revoke();
  },
  methods: {
    parseJson() {
      try {
        this.jsonValue = JSON.parse(this.value);
        this.error = null;
      } catch (e) {
        this.error = e.message || e;
      }
    },
    onChange() {
      if (this.error) return;
      const value = this.json ? this.jsonValue : this.value;
      if (this.sync) options.set(this.name, value);
      this.$emit('change', value);
    },
  },
};
</script>
