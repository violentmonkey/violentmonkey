<template>
  <div class="setting-text">
    <textarea
      ref="text"
      class="monospace-font"
      :class="{'has-error': error}"
      spellcheck="false"
      v-model="text"
      :disabled="disabled"
      :placeholder="placeholder"
      :rows="rows || calcRows(text)"
      @change="onChange"
      @ctrl-s="onSave"
    />
    <button v-if="hasSave" v-text="saved || i18n('buttonSave')" @click="onSave" :title="ctrlS"
            :disabled="disabled || !canSave"/>
    <button v-if="hasReset" v-text="i18n('buttonReset')" @click="onReset"
            :disabled="disabled || !canReset"/>
    <!-- DANGER! Keep the error tag in one line to keep the space which ensures the first word
         is selected correctly without the preceding button's text on double-click. -->
    <slot/> <span class="error text-red sep" v-text="error" v-if="json"/>
  </div>
</template>

<script>
import { i18n } from '@/common';
import { getUnloadSentry } from '@/common/router';
import { modifiers } from '@violentmonkey/shortcut';
import { deepEqual, objectGet } from '../object';
import options from '../options';
import defaults from '../options-defaults';
import hookSetting from '../hook-setting';

const ctrlS = modifiers.ctrlcmd === 'm' ? '⌘S' : 'Ctrl-S';

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
    rows: Number,
  },
  data() {
    return {
      ctrlS,
      error: null,
      placeholder: null,
      savedValue: null,
      saved: '',
      text: '',
      value: null,
    };
  },
  computed: {
    isDirty() {
      return !deepEqual(this.value, this.savedValue || '');
    },
    canSave() {
      return !this.error && this.isDirty;
    },
    canReset() {
      return !deepEqual(this.value, this.defaultValue || '');
    },
  },
  watch: {
    isDirty(state) {
      this.toggleUnloadSentry(state);
    },
    text(str) {
      let value;
      let error;
      if (this.json) {
        try {
          value = JSON.parse(str);
        } catch (e) {
          error = e.message;
        }
        this.error = error;
      } else {
        value = str;
      }
      this.value = value;
      this.saved = '';
    },
  },  created() {
    const handle = this.json
      ? (value => JSON.stringify(value, null, '  '))
      // XXX compatible with old data format
      : (value => (Array.isArray(value) ? value.join('\n') : value || ''));
    const defaultValue = objectGet(defaults, this.name);
    this.revoke = hookSetting(this.name, val => {
      this.savedValue = val;
      this.text = handle(val);
    });
    this.defaultValue = defaultValue;
    this.placeholder = handle(defaultValue);
    this.toggleUnloadSentry = getUnloadSentry(() => {
      // Reset to saved value after confirming loss of data.
      // The component won't be destroyed on tab change, so the changes are actually kept.
      // Here we reset it to make sure the user loses the changes when leaving the settings tab.
      // Otherwise the user may be confused about where the changes are after switching back.
      this.text = handle(this.savedValue);
    });
  },
  beforeUnmount() {
    this.revoke();
    this.toggleUnloadSentry(false);
  },
  methods: {
    onChange() {
      // Auto save if there is no `Save` button
      if (!this.hasSave && this.canSave) this.onSave();
    },
    onSave() {
      options.set(this.name, this.value).catch(this.bgError);
      this.saved = i18n('buttonSaved');
      this.$emit('save');
    },
    onReset() {
      const el = this.$refs.text;
      /* Focusing to allow quick Ctrl-Z to undo.
       * Focusing also prevents layout shift when `reset` button auto-hides. */
      el.focus();
      if (!this.hasSave) {
        // No save button = something rather trivial e.g. the export file name
        options.set(this.name, this.defaultValue).catch(this.bgError);
      } else {
        // Save button exists = let the user undo the input
        el.select();
        if (!document.execCommand('insertText', false, this.placeholder)) {
          this.value = this.placeholder;
        }
      }
    },
    bgError(err) {
      this.$emit('bg-error', err);
    },
  },
};
</script>

<style>
.setting-text {
  > .error {
    /* We've used .sep so our error text aligns with the buttons, now we need to undo some parts */
    display: inline;
    &::after {
      content: none;
    }
  }
}
</style>
