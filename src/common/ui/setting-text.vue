<template>
  <div>
    <textarea
      class="monospace-font"
      :class="{'has-error': parsedData.error}"
      spellcheck="false"
      v-model="value"
      :disabled="disabled"
      :title="parsedData.error"
      @change="onChange"
    />
    <button v-if="hasSave" v-text="i18n('buttonSave')" @click="onSave"
            :disabled="disabled || !canSave"/>
    <button v-if="hasReset" v-text="i18n('buttonReset')" @click="onReset"
            :disabled="disabled || !canReset"/>
    <slot/>
  </div>
</template>

<script>
import { deepEqual, objectGet } from '../object';
import options from '../options';
import defaults from '../options-defaults';
import hookSetting from '../hook-setting';

export default {
  props: {
    name: String,
    json: Boolean,
    disabled: Boolean,
    hasSave: {
      type: Boolean,
      default: true,
    },
    hasReset: Boolean,
  },
  data() {
    return {
      value: null,
      savedValue: null,
    };
  },
  computed: {
    parsedData() {
      let value;
      let error;
      if (this.json) {
        try {
          value = JSON.parse(this.value);
        } catch (e) {
          error = e.message || e;
        }
      } else {
        value = this.value;
      }
      return { value, error };
    },
    canSave() {
      return !this.parsedData.error && !deepEqual(this.parsedData.value, this.savedValue || '');
    },
    canReset() {
      return !deepEqual(this.parsedData.value, this.defaultValue || '');
    },
  },
  created() {
    const handle = this.json
      ? (value => JSON.stringify(value, null, '  '))
      // XXX compatible with old data format
      : (value => (Array.isArray(value) ? value.join('\n') : value || ''));
    this.revoke = hookSetting(this.name, val => {
      this.savedValue = Object.seal(val);
      this.value = handle(val);
    });
    this.defaultValue = objectGet(defaults, this.name);
  },
  beforeDestroy() {
    this.revoke();
  },
  methods: {
    onChange() {
      // Auto save if there is no `Save` button
      if (!this.hasSave && this.canSave) this.onSave();
    },
    onSave() {
      options.set(this.name, this.parsedData.value);
      this.$emit('save');
    },
    onReset() {
      options.set(this.name, this.defaultValue);
    },
  },
};
</script>
