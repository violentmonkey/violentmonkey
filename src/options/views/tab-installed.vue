<template>
  <div class="content no-pad">
    <header class="flex">
      <div class="flex-auto">
        <button v-text="i18n('buttonNew')" @click="newScript"></button>
        <button v-text="i18n('buttonUpdateAll')" @click="updateAll"></button>
        <button v-text="i18n('buttonInstallFromURL')" @click="installFromURL"></button>
      </div>
      <a href="https://greasyfork.org/scripts" target="_blank" v-text="i18n('anchorGetMoreScripts')"></a>
    </header>
    <div class="backdrop" :class="{mask: store.loading}" v-show="message">
      <div v-html="message"></div>
    </div>
    <div class="scripts">
      <item v-for="script in store.scripts" :key="script"
      :script="script" @edit="editScript" @move="moveScript"></item>
    </div>
    <edit v-if="script" :script="script" @close="endEditScript"></edit>
  </div>
</template>

<script>
import { i18n, sendMessage } from 'src/common';
import Item from './script-item';
import Edit from './edit';
import { store } from '../utils';

export default {
  components: {
    Item,
    Edit,
  },
  data() {
    return {
      store,
      script: null,
    };
  },
  computed: {
    message() {
      if (this.store.loading) {
        return i18n('msgLoading');
      }
      if (!this.store.scripts.length) {
        return i18n('labelNoScripts');
      }
    },
  },
  methods: {
    newScript() {
      sendMessage({ cmd: 'NewScript' })
      .then((script) => {
        this.script = script;
      });
    },
    updateAll() {
      sendMessage({ cmd: 'CheckUpdateAll' });
    },
    installFromURL() {
      const url = prompt(i18n('hintInputURL'));
      if (url && url.includes('://')) {
        const urlOptions = browser.runtime.getURL(browser.runtime.getManifest().options_page);
        browser.tabs.create({
          url: `${urlOptions}#confirm?u=${encodeURIComponent(url)}`,
        });
      }
    },
    editScript(id) {
      this.script = this.store.scripts.find(script => script.id === id);
    },
    endEditScript() {
      this.script = null;
    },
    moveScript(data) {
      if (data.from === data.to) return;
      sendMessage({
        cmd: 'Move',
        data: {
          id: this.store.scripts[data.from].id,
          offset: data.to - data.from,
        },
      })
      .then(() => {
        const { scripts } = this.store;
        const i = Math.min(data.from, data.to);
        const j = Math.max(data.from, data.to);
        const seq = [
          scripts.slice(0, i),
          scripts.slice(i, j + 1),
          scripts.slice(j + 1),
        ];
        if (i === data.to) {
          seq[1].unshift(seq[1].pop());
        } else {
          seq[1].push(seq[1].shift());
        }
        this.store.scripts = seq.concat.apply([], seq);
      });
    },
  },
};
</script>
