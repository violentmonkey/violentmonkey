<template>
  <section v-feature="'blacklist'">
    <h3>
      <span class="feature-text" v-text="i18n('labelBlacklist')"></span>
    </h3>
    <p>
      {{i18n('descBlacklist')}}
      <a href="https://violentmonkey.github.io/2017/04/15/Smart-rules-for-blacklist/#Blacklist-patterns" target="_blank" v-text="i18n('learnBlacklist')"></a>
    </p>
    <textarea v-model="rules"></textarea>
    <button v-text="i18n('buttonSaveBlacklist')" @click="onSave"></button>
  </section>
</template>

<script>
import { i18n, sendMessage } from 'src/common';
import options from 'src/common/options';
import { showMessage } from '../../utils';

export default {
  data() {
    let rules = options.get('blacklist');
    // XXX compatible
    if (Array.isArray(rules)) rules = rules.join('\n');
    return {
      rules,
    };
  },
  methods: {
    onSave() {
      options.set('blacklist', this.rules);
      showMessage({ text: i18n('msgSavedBlacklist') });
      sendMessage({ cmd: 'BlacklistReset' });
    },
  },
};
</script>
