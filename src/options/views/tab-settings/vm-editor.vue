<template>
  <section>
    <h3 v-text="i18n('labelEditor')"></h3>
    <p v-html="i18n('descEditorOptions')" />
    <setting-text name="editor" ref="editor" :json="true" />
    <button v-text="i18n('buttonSave')" @click="onSave"></button>
    <button v-text="i18n('buttonReset')" @click="onReset"></button>
  </section>
</template>

<script>
import { i18n } from '#/common';
import options from '#/common/options';
import { showMessage } from '#/options/utils';
import SettingText from '#/common/ui/setting-text';
import defaults from '#/common/options-defaults';

export default {
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
  },
};
</script>
