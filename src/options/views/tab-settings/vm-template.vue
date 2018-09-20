<template>
  <section>
    <h3 v-text="i18n('labelScriptTemplate')"></h3>
    <setting-text name="scriptTemplate" ref="template" />
    <button v-text="i18n('buttonSave')" @click="onSave"></button>
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
      options.set('scriptTemplate', this.$refs.template.value);
      showMessage({ text: i18n('msgSavedScriptTemplate') });
    },
  },
};
</script>
