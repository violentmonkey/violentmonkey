<template>
  <section>
    <h3 v-text="i18n('labelCustomCSS')"></h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <setting-text name="customCSS" @save="onSave"/>
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
      showMessage({ text: this.i18n('msgSavedCustomCSS') });
    },
  },
};
</script>
