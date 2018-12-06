<template>
  <section>
    <h3 v-text="i18n('labelBlacklist')"></h3>
    <p>
      {{i18n('descBlacklist')}}
      <a href="https://violentmonkey.github.io/2017/04/15/Smart-rules-for-blacklist/#blacklist-patterns" target="_blank" rel="noopener noreferrer" v-text="i18n('learnBlacklist')"></a>
    </p>
    <setting-text name="blacklist" ref="blacklist" />
    <button v-text="i18n('buttonSaveBlacklist')" @click="onSave"></button>
  </section>
</template>

<script>
import { i18n, sendMessage } from '#/common';
import options from '#/common/options';
import { showMessage } from '#/options/utils';
import SettingText from '#/common/ui/setting-text';

export default {
  components: {
    SettingText,
  },
  methods: {
    onSave() {
      options.set('blacklist', this.$refs.blacklist.value);
      showMessage({ text: i18n('msgSavedBlacklist') });
      sendMessage({ cmd: 'BlacklistReset' });
    },
  },
};
</script>
