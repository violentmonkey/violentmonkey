<template>
  <section v-feature="'blacklist'">
    <h3>
      <span class="feature-text" v-text="i18n('labelBlacklist')"></span>
    </h3>
    <p v-html="i18n('descBlacklist')"></p>
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
    const rules = options.get('blacklist') || [];
    return {
      rules: rules.join('\n'),
    };
  },
  methods: {
    onSave() {
      const rules = this.rules.split('\n')
      .map(item => item.trim())
      .filter(Boolean);
      options.set('blacklist', rules);
      showMessage({ text: i18n('msgSavedBlacklist') });
      sendMessage({ cmd: 'BlacklistReset' });
    },
  },
};
</script>
