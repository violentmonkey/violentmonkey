<template>
  <section>
    <h3 v-text="i18n('labelScriptTemplate')"></h3>
    <setting-text name="scriptTemplate" ref="template" />
    <button v-text="i18n('buttonSave')" @click="onSave"></button>
    <button v-text="i18n('buttonReset')" @click="onReset"></button>
  </section>
</template>

<script>
import { i18n } from '#/common';
import options from '#/common/options';
import { showMessage } from '#/options/utils';
import SettingText from '#/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
  methods: {
    onSave() {
      this.setTemplate(this.$refs.template.value);
    },
    onReset() {
      this.setTemplate('');
    },
    setTemplate(value) {
      options.set('scriptTemplate', value);
      showMessage({ text: i18n('msgSavedScriptTemplate') });
    },
  },
};
</script>
