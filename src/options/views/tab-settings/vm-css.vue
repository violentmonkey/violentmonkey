<template>
  <section>
    <h3 v-text="i18n('labelCustomCSS')"></h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <setting-text name="customCSS" mode="css" :msg-on-save="i18n('msgSavedCustomCSS')"/>
  </section>
</template>

<script>
import SettingText from '#/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
};
</script>
