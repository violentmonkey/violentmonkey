<template>
  <section>
    <h3 v-text="i18n('labelBlacklist')"></h3>
    <p>
      {{i18n('descBlacklist')}}
      <a href="https://violentmonkey.github.io/posts/smart-rules-for-blacklist/#blacklist-patterns" target="_blank" rel="noopener noreferrer" v-text="i18n('learnBlacklist')"></a>
    </p>
    <setting-text name="blacklist" @save="onSave"/>
  </section>
</template>

<script>
import { sendCmd } from '#/common';
import { showMessage } from '#/common/ui';
import SettingText from '#/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
  methods: {
    onSave() {
      showMessage({ text: this.i18n('msgSavedBlacklist') });
      sendCmd('BlacklistReset');
    },
  },
};
</script>
