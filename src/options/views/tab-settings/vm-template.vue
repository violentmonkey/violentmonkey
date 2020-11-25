<template>
  <section>
    <h3 v-text="i18n('labelScriptTemplate')"></h3>
    <setting-text name="scriptTemplate" @save="onSave"/>
  </section>
</template>

<script>
import { showMessage } from '#/common/ui';
import SettingText from '#/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
  methods: {
    onSave() {
      showMessage({ text: this.i18n('msgSavedScriptTemplate') });
    },
  },
};
</script>
