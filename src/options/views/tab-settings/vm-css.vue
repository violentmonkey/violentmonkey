<template>
  <feature name="css" tag="section">
    <h3>
      <span class="feature-text" v-text="i18n('labelCustomCSS')"></span>
    </h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <setting-text name="customCSS" ref="css" />
    <button v-text="i18n('buttonSaveCustomCSS')" @click="onSave"></button>
  </feature>
</template>

<script>
import { i18n } from 'src/common';
import options from 'src/common/options';
import { showMessage } from 'src/options/utils';
import SettingText from 'src/common/ui/setting-text';
import Feature from '../feature';

export default {
  components: {
    SettingText,
    Feature,
  },
  methods: {
    onSave() {
      options.set('customCSS', this.$refs.css.value);
      showMessage({ text: i18n('msgSavedCustomCSS') });
    },
  },
};
</script>
