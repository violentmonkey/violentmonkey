<template>
  <div class="content no-pad">
    <header class="flex">
      <div class="flex-auto">
        <button v-text="i18n('buttonNew')" @click="newScript"></button>
        <button v-text="i18n('buttonUpdateAll')" @click="updateAll"></button>
        <button v-text="i18n('buttonInstallFromURL')" @click="installFromURL"></button>
      </div>
      <div v-dropdown>
        <button dropdown-toggle v-text="i18n('anchorGetMoreScripts')"></button>
        <div class="dropdown-menu">
          <a href="https://openuserjs.org/" target="_blank">OpenUserJS</a>
          <a href="https://greasyfork.org/scripts" target="_blank">GreasyFork</a>
        </div>
      </div>
    </header>
    <div class="scripts">
      <item v-for="script in store.scripts" :key="script"
      :script="script" @edit="editScript" @move="moveScript"></item>
    </div>
    <div class="backdrop" :class="{mask: store.loading}" v-show="message">
      <div v-html="message"></div>
    </div>
    <edit v-if="script" v-model="script" @close="endEditScript"></edit>
  </div>
</template>

<script>
import { i18n, sendMessage, noop } from 'src/common';
import Item from './script-item';
import Edit from './edit';
import { store, showMessage } from '../utils';

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
      new Promise((resolve, reject) => {
        showMessage({
          text: i18n('hintInputURL'),
          onBackdropClick: reject,
          buttons: [
            {
              type: 'submit',
              text: i18n('buttonOK'),
              onClick: resolve,
            },
            {
              text: i18n('buttonCancel'),
              onClick: reject,
            },
          ],
        });
      })
      .then(url => {
        if (url && url.includes('://')) return sendMessage({ cmd: 'ConfirmInstall', data: { url } });
      }, noop)
      .catch(err => {
        if (err) showMessage({ text: err });
      });
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

<style>
.backdrop,
.scripts {
  position: absolute;
  top: 2rem;
  left: 0;
  right: 0;
  bottom: 0;
}
.scripts {
  overflow-y: auto;
}
.backdrop {
  text-align: center;
  color: gray;
}
.backdrop > *,
.backdrop::after {
  display: inline-block;
  vertical-align: middle;
  font-size: 2rem;
}
.backdrop::after {
  content: ' ';
  width: 0;
  height: 100%;
}
.mask {
  background: rgba(0,0,0,.08);
  /*transition: opacity 1s;*/
}
</style>
