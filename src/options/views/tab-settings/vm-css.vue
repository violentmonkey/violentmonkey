<template>
  <section v-feature="'css'">
    <h3>
      <span class="feature-text" v-text="i18n('labelCustomCSS')"></span>
    </h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <setting-text name="customCSS" ref="css" />
    <button v-text="i18n('buttonSaveCustomCSS')" @click="onSave"></button>
  </section>
</template>

<script>
import { i18n } from 'src/common';
import options from 'src/common/options';
import { showMessage } from 'src/options/utils';
import SettingText from 'src/common/ui/setting-text';

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
