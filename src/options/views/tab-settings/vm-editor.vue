<template>
  <section>
    <h3 v-text="i18n('labelEditor')"></h3>
    <p v-html="i18n('descEditorOptions')" />
    <setting-text name="editor" ref="editor" :json="true" />
    <button v-text="i18n('buttonSave')" @click="onSave"></button>
    <button v-text="i18n('buttonReset')" @click="onReset"></button>
    <button v-text="i18n('buttonShowEditorState')" @click="toggleStateHint" />
    <pre v-text="hint" class="monospace-font dim-hint" />
  </section>
</template>

<script>
import { i18n } from '#/common';
import options from '#/common/options';
import { showMessage } from '#/options/utils';
import SettingText from '#/common/ui/setting-text';
import defaults from '#/common/options-defaults';

export default {
  data() {
    return { hint: null };
  },
  components: {
    SettingText,
  },
  mounted() {
    this.$refs.editor.$el.addEventListener('dblclick', this.toggleBoolean);
  },
  methods: {
    onSave() {
      const { jsonValue, error } = this.$refs.editor;
      if (!error) options.set('editor', jsonValue);
      showMessage({ text: error || i18n('msgSavedEditorOptions') });
    },
    onReset() {
      options.set('editor', defaults.editor);
    },
    toggleBoolean(event) {
      const el = event.target;
      const selection = el.value.slice(el.selectionStart, el.selectionEnd);
      const toggled = selection === 'false' && 'true' || selection === 'true' && 'false';
      if (toggled) document.execCommand('insertText', false, toggled);
    },
    async toggleStateHint() {
      if (this.hint) {
        this.hint = null;
        return;
      }
      const HIDE_OPTS = [
        // we activate only one mode: js
        'mode',
        // duh
        'value',
        // these accept only a function
        'configureMouse',
        'lineNumberFormatter',
        'specialCharPlaceholder',
      ];
      const opts = {};
      Object.entries({
        ...(await import('codemirror')).defaults,
        ...(await import('#/common/ui/code')).cmOptions,
        ...options.get('editor'),
      })
      // sort by keys alphabetically to make it more readable
      .sort(([a], [b]) => (a < b ? -1 : a > b))
      .filter(([key, val]) => !HIDE_OPTS.includes(key) && typeof val !== 'function')
      .forEach(([key, val]) => { opts[key] = val; });
      this.hint = JSON.stringify(opts, null, '  ');
      setTimeout(() => {
        if (this.$el.getBoundingClientRect().bottom > window.innerHeight) {
          this.$el.scrollIntoView({ behavior: 'smooth' });
        }
      });
    },
  },
};
</script>

<style>
  .dim-hint {
    font-size: .85rem;
    color: var(--fill-8);
  }
</style>
