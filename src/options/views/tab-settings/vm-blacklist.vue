<template>
  <section v-feature="'blacklist'">
    <h3>
      <span class="feature-text" v-text="i18n('labelBlacklist')"></span>
    </h3>
    <p>
      {{i18n('descBlacklist')}}
      <a href="https://violentmonkey.github.io/2017/04/15/Smart-rules-for-blacklist/#Blacklist-patterns" target="_blank" v-text="i18n('learnBlacklist')"></a>
    </p>
    <setting-text name="blacklist" ref="blacklist" />
    <button v-text="i18n('buttonSaveBlacklist')" @click="onSave"></button>
  </section>
</template>

<script>
import { i18n, sendMessage } from 'src/common';
import options from 'src/common/options';
import { showMessage } from 'src/options/utils';
import SettingText from 'src/common/ui/setting-text';

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
