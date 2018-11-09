<template>
  <section>
    <h3 v-text="i18n('labelCustomCSS')"></h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <setting-text name="customCSS" ref="css" />
    <button v-text="i18n('buttonSaveCustomCSS')" @click="onSave"></button>
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
      options.set('customCSS', this.$refs.css.value);
      showMessage({ text: i18n('msgSavedCustomCSS') });
    },
  },
};
</script>
