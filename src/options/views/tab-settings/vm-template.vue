<template>
  <section>
    <h3 v-text="i18n('labelScriptTemplate')"></h3>
    <setting-text name="scriptTemplate" mode="javascript"
                  :msg-on-save="i18n('msgSavedScriptTemplate')"/>
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
