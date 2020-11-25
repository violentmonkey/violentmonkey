<template>
  <div>
    <textarea
      class="monospace-font"
      :class="{'has-error': error}"
      spellcheck="false"
      v-model="value"
      :disabled="disabled"
      :title="error"
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
      jsonValue: null,
      error: null,
      canSave: null,
      canReset: null,
    };
  },
  created() {
    const handle = this.json
      ? (value => JSON.stringify(value, null, '  '))
      // XXX compatible with old data format
      : (value => (Array.isArray(value) ? value.join('\n') : value || ''));
    this.revoke = hookSetting(this.name, val => {
      this.savedValue = val;
      val = handle(val);
      if (this.value !== val) this.value = val; // will call onInput
      else this.onInput(val);
    });
    this.defaultValue = objectGet(defaults, this.name);
    this.$watch('value', this.onInput);
  },
  beforeDestroy() {
    this.revoke();
  },
  methods: {
    onInput(val) {
      if (this.json) {
        try {
          val = JSON.parse(val);
          this.jsonValue = val;
          this.error = null;
        } catch (e) {
          this.error = e.message || e;
        }
      }
      this.canSave = this.hasSave && !this.error && !deepEqual(val, this.savedValue || '');
      this.canReset = this.hasReset && !deepEqual(val, this.defaultValue || '');
    },
    onChange() {
      if (!this.error) {
        options.set(this.name, this.json ? this.jsonValue : this.value);
      }
    },
    onSave() {
      this.$emit('save');
    },
    onReset() {
      options.set(this.name, this.defaultValue);
    },
  },
};
</script>
